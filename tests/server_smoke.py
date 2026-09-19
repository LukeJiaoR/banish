#!/usr/bin/env python3
"""服务器冒烟测试：python3 tests/server_smoke.py
启动 server.py 于随机端口（反馈目录指向临时目录），验证：
静态托管、反馈落盘、空内容拒绝、限频、token 鉴权查看。
全部命中即退出码 0，可挂 CI。"""
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
passed, failed = 0, 0


def check(name, cond, extra=''):
    global passed, failed
    if cond:
        passed += 1
        print('  ok  ' + name)
    else:
        failed += 1
        print(f'FAIL  {name} {extra}')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def req(port, path, method='GET', body=None, ctype='application/json'):
    """请求本机临时测试服务：主机固定为 127.0.0.1 回环，仅端口与路径可变。"""
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    headers = {'Content-Type': ctype} if body else {}
    try:
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        return resp.status, resp.read().decode('utf-8', 'replace')
    finally:
        conn.close()


def post(port, payload):
    return req(port, '/api/feedback', 'POST', json.dumps(payload).encode('utf-8'))


tmp = tempfile.mkdtemp(prefix='banish-fb-test-')
port = free_port()
env = dict(os.environ, FEEDBACK_TOKEN='test-token', FEEDBACK_DIR=tmp)
proc = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), str(port)],
                        cwd=str(ROOT), env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            if req(port, '/')[0] == 200:
                break
        except OSError:
            pass
        time.sleep(0.1)

    st, body = req(port, '/')
    check('静态首页 200 且为游戏页', st == 200 and '放逐小镇' in body)
    st, body = req(port, '/js/feedback.js')
    check('静态脚本可访问', st == 200 and 'G.feedback' in body)
    st, body = req(port, '/js/')
    check('目录列表被禁止', st == 403)

    st, body = post(port, {'pid': 'p-test0001', 'text': '第一个冬天必死，柴火不够', 'name': '测试员'})
    check('有效反馈 200 ok', st == 200 and json.loads(body).get('ok') is True)

    files = sorted(Path(tmp).glob('feedback-*.jsonl'))
    entry = None
    if files:
        lines = files[-1].read_text(encoding='utf-8').splitlines()
        entry = json.loads(lines[-1])
    check('反馈落盘 JSONL（含正文/昵称/进度字段）',
          entry is not None and entry['text'] == '第一个冬天必死，柴火不够'
          and entry['name'] == '测试员' and 'progress' in entry and 'ip' in entry and len(entry['ip']) == 16)

    st, body = post(port, {'text': '   '})
    check('空反馈 400', st == 400)

    st, body = req(port, '/api/feedback')
    check('无 token 查看 403', st == 403)
    st, body = req(port, '/api/feedback?token=wrong')
    check('错误 token 403', st == 403)
    st, body = req(port, '/api/feedback?token=test-token')
    check('正确 token 可查看全部反馈', st == 200 and '柴火不够' in body)

    for i in range(5):  # 已发 2 条，再发 5 条到限频阈值 6
        post(port, {'pid': 'p-test0001', 'text': f'第 {i} 条'})
    st, body = post(port, {'pid': 'p-test0001', 'text': '超限的一条'})
    check('超频 429', st == 429)
finally:
    proc.terminate()
    proc.wait(timeout=5)
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

print(f'\n{failed == 0 and "全部通过" or "有失败"}: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
