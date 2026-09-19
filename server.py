#!/usr/bin/env python3
"""放逐小镇 · 部署服务器：静态托管 + 匿名反馈收集（零依赖，Python 标准库）。

用法:
  python3 server.py [端口]                      # 默认 8613，绑定所有网卡
  FEEDBACK_TOKEN=私密token python3 server.py    # 开启在线查看反馈接口

反馈入口是游戏右上角 📮（无需注册）。POST /api/feedback 的内容校验、限频后
追加写入 feedback/feedback-YYYYMM.jsonl（每行一个 JSON，含进度摘要 / 存档快照 /
脚本错误 / IP 哈希）。不设置 FEEDBACK_TOKEN 时无在线查看接口，直接 ssh cat 文件。
"""
import functools
import hashlib
import json
import os
import sys
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8613
TOKEN = os.environ.get('FEEDBACK_TOKEN', '')
ROOT = os.path.dirname(os.path.abspath(__file__))
FB_DIR = os.environ.get('FEEDBACK_DIR') or os.path.join(ROOT, 'feedback')
MAX_BODY = 1_500_000        # 单条反馈上限（字节），超限拒绝
MAX_TEXT = 2000             # 反馈正文上限（字符），与前端一致
MAX_MONTH_BYTES = 50 * 1024 * 1024   # 单月反馈文件上限，防刷盘
RATE_WINDOW = 600           # 每 IP 每 10 分钟
RATE_MAX = 6

_lock = threading.Lock()
_hits = {}                   # ip -> [timestamp, ...]


def _month_file():
    os.makedirs(FB_DIR, exist_ok=True)
    return os.path.join(FB_DIR, time.strftime('feedback-%Y%m.jsonl'))


def _salt():
    """IP 哈希盐：首次生成后固定，避免重启后同一 IP 出不同哈希。"""
    fb = os.path.realpath(FB_DIR)
    os.makedirs(fb, exist_ok=True)
    p = os.path.realpath(os.path.join(fb, '.salt'))
    if os.path.dirname(p) != fb:
        raise RuntimeError(f'FEEDBACK_DIR 非法：{FB_DIR}')  # 盐文件必须恰好落在反馈目录内
    try:
        with open(p, encoding='utf-8') as f:
            s = f.read().strip()
            if s:
                return s
    except FileNotFoundError:
        pass
    s = os.urandom(16).hex()
    try:
        # 原子创建（O_EXCL）：并发请求只会有一个写成功，且绝不覆盖已有盐
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        with open(p, encoding='utf-8') as f:
            return f.read().strip()
    try:
        os.write(fd, s.encode('utf-8'))
    finally:
        os.close(fd)
    return s


def _s(v, limit):
    return v.strip()[:limit] if isinstance(v, str) else ''


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def translate_path(self, path):
        """静态文件一律限制在站点根目录内（防目录穿越，纵深防御）。"""
        p = super().translate_path(path)
        root = os.path.realpath(ROOT)
        real = os.path.realpath(p)
        if real != root and not real.startswith(root + os.sep):
            return os.path.join(ROOT, '__outside__.notexist')
        return p

    def list_directory(self, path):
        self.send_error(403)
        return None

    def log_message(self, fmt, *args):
        sys.stderr.write('[%s] %s\n' % (self.log_date_time_string(), fmt % args))

    # ---------- 反馈接口 ----------
    def do_POST(self):
        if urllib.parse.urlparse(self.path).path == '/api/feedback':
            self._feedback()
        else:
            self.send_error(404)

    def _feedback(self):
        ip = self.client_address[0]
        with _lock:
            now = time.time()
            hits = [t for t in _hits.get(ip, ()) if now - t < RATE_WINDOW]
            if len(hits) >= RATE_MAX:
                self._json(429, {'ok': False, 'error': '发送太频繁，请稍后再试'})
                return
            hits.append(now)
            _hits[ip] = hits
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            self._json(413, {'ok': False, 'error': '内容超限'})
            return
        raw = self.rfile.read(n)
        try:
            data = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {'ok': False, 'error': '无法解析的反馈内容'})
            return
        text = _s(data.get('text'), MAX_TEXT)
        if not text:
            self._json(400, {'ok': False, 'error': '反馈内容为空'})
            return
        t = data.get('t')
        entry = {
            'recv': time.time(),
            't': t if isinstance(t, (int, float)) else time.time() * 1000,
            'ip': hashlib.sha256((_salt() + ip).encode('utf-8')).hexdigest()[:16],
            'pid': _s(data.get('pid'), 32),
            'name': _s(data.get('name'), 40),
            'text': text,
            'ua': _s(data.get('ua'), 300),
            'lang': _s(data.get('lang'), 20),
            'screen': _s(data.get('screen'), 20),
            'progress': data.get('progress') if isinstance(data.get('progress'), dict) else None,
            'save': data.get('save') if isinstance(data.get('save'), dict) else None,
            'errs': data.get('errs') if isinstance(data.get('errs'), list) else [],
        }
        with _lock:
            mf = _month_file()
            if os.path.exists(mf) and os.path.getsize(mf) > MAX_MONTH_BYTES:
                self._json(507, {'ok': False, 'error': '本月反馈已满，请联系开发者'})
                return
            with open(mf, 'a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        self._json(200, {'ok': True})

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == '/api/feedback':
            if not TOKEN:
                self.send_error(404)
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if qs.get('token', [''])[0] != TOKEN:
                self.send_error(403)
                return
            lines = []
            if os.path.isdir(FB_DIR):
                for fn in sorted(os.listdir(FB_DIR)):
                    if fn.endswith('.jsonl'):
                        with open(os.path.join(FB_DIR, fn), encoding='utf-8') as f:
                            lines += f.read().splitlines()
            body = ('\n'.join(lines) or '（暂无反馈）').encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    os.chdir(ROOT)  # 静态文件以脚本所在目录为根，与启动位置无关
    print(f'归园 · 放逐小镇: http://0.0.0.0:{PORT}  反馈落盘 → {FB_DIR}'
          + (f'  在线查看: /api/feedback?token=***' if TOKEN else ''), flush=True)
    ThreadingHTTPServer(('', PORT), functools.partial(Handler, directory=ROOT)).serve_forever()
