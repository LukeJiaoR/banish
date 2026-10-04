#!/usr/bin/env python3
"""服务器冒烟测试：python3 tests/server_smoke.py
启动 server.py 于随机端口（反馈目录指向临时目录），验证：
静态托管、反馈落盘、空内容拒绝、限频、token 鉴权查看，
存档接口（写入/列表/读取/删除 + 非法名消毒 + 超限拒绝）。
全部命中即退出码 0，可挂 CI。"""
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
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
saves_tmp = tempfile.mkdtemp(prefix='banish-saves-test-')
port = free_port()
env = dict(os.environ, FEEDBACK_TOKEN='test-token', FEEDBACK_DIR=tmp, SAVES_DIR=saves_tmp)
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

    # ---------- 服务器存档接口 ----------
    def saves(port, path, method='GET', payload=None):
        body = json.dumps(payload).encode('utf-8') if payload is not None else None
        return req(port, path, method, body)

    qname = urllib.parse.quote('测试档·二')
    save_data = {'game': {'year': 2, 'season': 1, 'day': 60, 'res': {'food': 812}},
                 'citizens': [{'id': 1}], 'trees': [], 'buildings': [], 'families': []}
    st, body = saves(port, '/api/saves', 'POST', {'name': '测试档·二', 'data': save_data})
    check('存档写入 200', st == 200 and json.loads(body).get('ok') is True)
    check('存档落盘 JSON 文件', (Path(saves_tmp) / '测试档·二.json').is_file())

    st, body = saves(port, '/api/saves')
    lst = json.loads(body)
    check('存档列表含摘要（年/季/天/人口/食物）',
          st == 200 and lst['ok'] and len(lst['saves']) == 1
          and lst['saves'][0]['name'] == '测试档·二'
          and lst['saves'][0]['summary']['year'] == 2
          and lst['saves'][0]['summary']['food'] == 812
          and lst['saves'][0]['summary']['pop'] == 1)

    st, body = saves(port, '/api/saves/' + qname)
    d = json.loads(body)
    check('存档读取完整且盖服务器时间戳',
          st == 200 and d['game']['res']['food'] == 812 and d.get('savedAt'))

    for bad in ['../evil', 'a/b', '  ', '.hidden', 'x' * 41]:
        st, body = saves(port, '/api/saves', 'POST', {'name': bad, 'data': {'game': {}}})
        assert st == 400, f'非法名 {bad!r} 应 400，实得 {st}'
    check('非法存档名全部 400（穿越/空/斜杠/隐藏/超长）', True)

    st, body = saves(port, '/api/saves', 'POST', {'name': '无数据档'})
    check('缺存档数据 400', st == 400)
    st, body = req(port, '/api/saves', 'POST', b'{oops', ctype='application/json')
    check('坏 JSON 400', st == 400)
    st, body = req(port, '/api/saves', 'POST',
                   json.dumps({'name': '大档', 'data': {'x': 'y' * (8_000_001)}}).encode('utf-8'))
    check('超限存档 413', st == 413)

    st, body = saves(port, '/api/saves/' + qname, 'DELETE')
    check('删除存档 200', st == 200 and json.loads(body)['ok'])
    st, body = saves(port, '/api/saves/' + qname, 'DELETE')
    check('重复删除 404', st == 404)
    st, body = saves(port, '/api/saves/' + qname)
    check('删除后读取 404', st == 404)
finally:
    proc.terminate()
    proc.wait(timeout=5)
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(saves_tmp, ignore_errors=True)

print(f'\n{failed == 0 and "全部通过" or "有失败"}: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
