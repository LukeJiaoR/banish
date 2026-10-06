#!/usr/bin/env python3
"""放逐小镇 · 部署服务器：静态托管 + 匿名反馈收集 + 服务器存档（零依赖，Python 标准库）。

用法:
  python3 server.py [端口]                      # 默认 8613，绑定所有网卡
  FEEDBACK_TOKEN=私密token python3 server.py    # 开启在线查看反馈接口
  SAVES_DIR=/path/to/saves python3 server.py    # 自定义存档目录（默认 ./saves）

反馈入口是游戏右上角 📮（无需注册）。POST /api/feedback 的内容校验、限频后
追加写入 feedback/feedback-YYYYMM.jsonl（每行一个 JSON，含进度摘要 / 存档快照 /
脚本错误 / IP 哈希）。不设置 FEEDBACK_TOKEN 时无在线查看接口，直接 ssh cat 文件。

服务器存档：存档为 JSON 文件落在 saves/ 目录，跨浏览器、跨设备共享。
  GET    /api/saves            # 列出全部存档（含年份/季节/人口/食物摘要）
  GET    /api/saves/<名字>      # 读取一份存档
  POST   /api/saves            # 写入 {name, data}（原子落盘，同名覆盖）
  DELETE /api/saves/<名字>      # 删除一份存档
自动档每 90 秒镜像到服务器 autosave.json（写失败静默跳过，不影响本机档）。
"""
import functools
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8613
TOKEN = os.environ.get('FEEDBACK_TOKEN', '')
ROOT = os.path.dirname(os.path.abspath(__file__))
FB_DIR = os.environ.get('FEEDBACK_DIR') or os.path.join(ROOT, 'feedback')
SAVES_DIR = os.environ.get('SAVES_DIR') or os.path.join(ROOT, 'saves')
MAX_BODY = 1_500_000        # 单条反馈上限（字节），超限拒绝
MAX_SAVE_BODY = 8_000_000   # 单个存档上限（字节）：全图树木+市民约 1-2MB，留足余量
MAX_TEXT = 2000             # 反馈正文上限（字符），与前端一致
MAX_MONTH_BYTES = 50 * 1024 * 1024   # 单月反馈文件上限，防刷盘
RATE_WINDOW = 600           # 每 IP 每 10 分钟
RATE_MAX = 6
SAVE_RATE_MAX = 90          # 存档限频放宽：自动档每 90s 镜像一次 ≈ 40 次/10 分钟
SAVE_NAME_RE = re.compile(
    r'^[\u4e00-\u9fffA-Za-z0-9][\u4e00-\u9fffA-Za-z0-9_\- ··()（）]{0,39}$')

_lock = threading.Lock()
_hits = {}                   # ip -> [timestamp, ...]（反馈）
_save_hits = {}              # ip -> [timestamp, ...]（存档写入）


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


def _save_path(name):
    """存档名 → saves/ 内的安全路径；非法名返回 None。
    只允许中日韩文字/字母/数字开头，1-40 字符（可含空格 · - _ 括号），
    天然排除路径分隔符、隐藏文件与 ..；realpath 双重确认不逃出存档目录。"""
    if not isinstance(name, str):
        return None
    name = name.strip()
    if not SAVE_NAME_RE.match(name):
        return None
    os.makedirs(SAVES_DIR, exist_ok=True)
    root = os.path.realpath(SAVES_DIR)
    p = os.path.realpath(os.path.join(root, name + '.json'))
    if os.path.dirname(p) != root:
        return None
    return p


def _save_summary(path):
    """尽力提取存档摘要（年份/季节/天数/人口/食物），坏档不阻塞列表。"""
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        g = d.get('game') or {}
        res = g.get('res') or {}
        return {
            'savedAt': d.get('savedAt'),
            'year': g.get('year'), 'season': g.get('season'), 'day': g.get('day'),
            'pop': len(d.get('citizens') or []),
            'food': res.get('food'),
        }
    except Exception:
        return None


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
        path = urllib.parse.urlparse(self.path).path
        if path == '/api/feedback':
            self._feedback()
        elif path == '/api/saves':
            self._save_write()
        else:
            self.send_error(404)

    def _rate_hit(self, table, max_hits, msg):
        """每 IP 滑动窗口限频；超限返回 True（并已回复 429）。"""
        ip = self.client_address[0]
        with _lock:
            now = time.time()
            hits = [t for t in table.get(ip, ()) if now - t < RATE_WINDOW]
            if len(hits) >= max_hits:
                self._json(429, {'ok': False, 'error': msg})
                return True
            hits.append(now)
            table[ip] = hits
        return False

    def _read_json_body(self, max_bytes):
        """读取请求体并解析 JSON；失败时已回复 4xx，返回 None。"""
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > max_bytes:
            # 超限先排干请求体再回复：客户端仍在发送途中，直接关闭会让它
            # 看到 RemoteDisconnected 而不是 413（排空上限 64MB，更大直接断）
            left = min(n, 64 * 1024 * 1024)
            try:
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    left -= len(chunk)
            except OSError:
                pass
            self.close_connection = True
            self._json(413, {'ok': False, 'error': '内容超限'})
            return None
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {'ok': False, 'error': '无法解析的内容'})
            return None

    def _feedback(self):
        if self._rate_hit(_hits, RATE_MAX, '发送太频繁，请稍后再试'):
            return
        data = self._read_json_body(MAX_BODY)
        if data is None:
            return
        if not isinstance(data, dict):
            self._json(400, {'ok': False, 'error': '无法解析的反馈内容'})
            return
        text = _s(data.get('text'), MAX_TEXT)
        if not text:
            self._json(400, {'ok': False, 'error': '反馈内容为空'})
            return
        t = data.get('t')
        ip = self.client_address[0]  # 限频在 _rate_hit 内，这里取一次做哈希
        entry = {
            'recv': time.time(),
            't': t if isinstance(t, (int, float)) else time.time() * 1000,
            'ip': hashlib.sha256((_salt() + ip).encode('utf-8')).hexdigest()[:16],
            'pid': _s(data.get('pid'), 32),
            'v': _s(data.get('v'), 24),  # 游戏版本号：反馈可归因到具体数值补丁
            'hist': data.get('hist') if isinstance(data.get('hist'), list) else [],
            'buildLog': data.get('buildLog') if isinstance(data.get('buildLog'), list) else [],
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

    # ---------- 服务器存档接口 ----------
    def _save_write(self):
        """POST /api/saves {name, data}：校验、限频、原子落盘（同名覆盖）。"""
        if self._rate_hit(_save_hits, SAVE_RATE_MAX, '保存太频繁，请稍后再试'):
            return
        data = self._read_json_body(MAX_SAVE_BODY)
        if data is None:
            return
        if not isinstance(data, dict):
            self._json(400, {'ok': False, 'error': '存档内容格式错误'})
            return
        name = data.get('name')
        p = _save_path(name)
        if not p:
            self._json(400, {'ok': False, 'error': '存档名限 1-40 字符（中文/字母/数字开头）'})
            return
        body = data.get('data')
        if not isinstance(body, dict):
            self._json(400, {'ok': False, 'error': '缺少存档数据'})
            return
        body['savedAt'] = time.time() * 1000  # 以服务器落盘时间为准
        with _lock:
            try:
                fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), suffix='.tmp')
                try:
                    with os.fdopen(fd, 'w', encoding='utf-8') as f:
                        json.dump(body, f, ensure_ascii=False)
                    os.replace(tmp, p)  # 原子替换：写一半断电不会留下坏档
                except BaseException:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass
                    raise
            except OSError as e:
                self._json(500, {'ok': False, 'error': f'存档写入失败：{e.strerror}'})
                return
        self._json(200, {'ok': True, 'name': name})

    def _save_list(self):
        """GET /api/saves：列出全部存档与摘要，坏档不阻塞列表。"""
        try:
            os.makedirs(SAVES_DIR, exist_ok=True)
            names = sorted(os.listdir(SAVES_DIR))
        except OSError:
            self._json(200, {'ok': True, 'saves': []})
            return
        items = []
        for fn in names:
            if not fn.endswith('.json') or fn.startswith('.'):
                continue
            p = os.path.join(SAVES_DIR, fn)
            try:
                st = os.stat(p)
            except OSError:
                continue
            items.append({'name': fn[:-5], 'size': st.st_size,
                          'mtime': st.st_mtime * 1000, 'summary': _save_summary(p)})
        self._json(200, {'ok': True, 'saves': items})

    def _save_read(self, name):
        """GET /api/saves/<名字>：返回存档 JSON；不存在 404。"""
        p = _save_path(name)
        if not p or not os.path.isfile(p):
            self._json(404, {'ok': False, 'error': '存档不存在'})
            return
        try:
            with open(p, 'rb') as f:
                body = f.read()
        except OSError:
            self._json(500, {'ok': False, 'error': '存档读取失败'})
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _save_delete(self, name):
        """DELETE /api/saves/<名字>：删除一份存档；不存在 404。"""
        p = _save_path(name)
        if not p or not os.path.isfile(p):
            self._json(404, {'ok': False, 'error': '存档不存在'})
            return
        with _lock:
            try:
                os.remove(p)
            except OSError:
                self._json(500, {'ok': False, 'error': '删除失败'})
                return
        self._json(200, {'ok': True})

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/api/saves':
            self._save_list()
        elif path.startswith('/api/saves/'):
            self._save_read(urllib.parse.unquote(path[len('/api/saves/'):]))
        elif path == '/api/feedback':
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

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/api/saves/'):
            self._save_delete(urllib.parse.unquote(path[len('/api/saves/'):]))
        else:
            self.send_error(404)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    os.chdir(ROOT)  # 静态文件以脚本所在目录为根，与启动位置无关
    print(f'归园 · 放逐小镇: http://0.0.0.0:{PORT}  反馈落盘 → {FB_DIR}  存档目录 → {SAVES_DIR}'
          + (f'  在线查看: /api/feedback?token=***' if TOKEN else ''), flush=True)
    ThreadingHTTPServer(('', PORT), functools.partial(Handler, directory=ROOT)).serve_forever()
