#!/usr/bin/env python3
"""Lightweight local deployment checks; synthetic saves only, not a load benchmark."""
from concurrent.futures import ThreadPoolExecutor
import functools
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('banish_server', ROOT / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


with tempfile.TemporaryDirectory(prefix='banish-deployment-') as tmp:
    server.FB_DIR = str(Path(tmp) / 'feedback')
    server.SAVES_DIR = str(Path(tmp) / 'saves')
    server.COOKIE_SECURE = False
    server.SAVE_RATE_MAX = 3  # Exercise real HTTP limit boundaries with few writes.
    server.RATE_MAX = 2
    srv = server.ThreadingHTTPServer(('127.0.0.1', 0),
                                    functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()

    class Client:
        def __init__(self, headers=()):
            self.cookie = ''
            self.headers = list(headers)

        def req(self, path, method='GET', data=None, extra=()):
            body = json.dumps(data).encode() if data is not None else None
            c = http.client.HTTPConnection(*srv.server_address, timeout=10)
            try:
                c.putrequest(method, path)
                c.putheader('Cookie', self.cookie)
                for name, value in self.headers + list(extra):
                    c.putheader(name, value)
                if body is not None:
                    c.putheader('Content-Type', 'application/json')
                    c.putheader('Content-Length', str(len(body)))
                c.endheaders(body)
                r = c.getresponse()
                if r.getheader('Set-Cookie'):
                    self.cookie = r.getheader('Set-Cookie').split(';')[0]
                return r.status, r.read(), r.getheader('Content-Type', '')
            finally:
                c.close()

        def save(self, marker):
            return self.req('/api/saves', 'POST',
                            {'name': 'autosave', 'data': {'game': {'day': marker}}})[0]

    try:
        # Real served CSS, including HEAD, rather than only checking the allowlist.
        for css in sorted((ROOT / 'styles').glob('*.css')):
            for method in ('GET', 'HEAD'):
                status, body, ctype = Client().req('/styles/' + css.name, method)
                assert status == 200 and ctype.startswith('text/css'), css.name
                assert body == (css.read_bytes() if method == 'GET' else b'')
        for path in ('/server.py', '/.git/config', '/styles/../server.py',
                     '/styles/%2e%2e/server.py', '/styles/../saves/autosave.json'):
            for method in ('GET', 'HEAD'):
                assert Client().req(path, method)[0] == 404, (path, method)
        print('PASS: all five deployed stylesheets GET/HEAD; private paths remain blocked')

        # No trust by default: forged client identity headers never reset a budget.
        for trusted in (frozenset(), frozenset({'192.0.2.254'})):
            server.TRUSTED_PROXY_IPS = trusted
            server._save_hits.clear()
            a = Client(); assert a.req('/api/saves')[0] == 200
            for i in range(3):
                a.headers = [('X-Real-IP', f'198.51.100.{i + 1}'),
                             ('X-Forwarded-For', f'203.0.113.{i + 1}')]
                assert a.save(i) == 200
            a.headers = [('X-Real-IP', '198.51.100.99'), ('X-Forwarded-For', '203.0.113.99')]
            assert a.save(99) == 429
            assert set(server._save_hits) == {'127.0.0.1'}
        print('PASS: default/untrusted peers cannot spoof forwarding headers to bypass limits')

        # Explicit trusted proxy: independent real client IPs get separate budgets.
        server.TRUSTED_PROXY_IPS = frozenset({'127.0.0.1'})
        server._save_hits.clear()
        a = Client([('X-Real-IP', '198.51.100.1')])
        b = Client([('X-Real-IP', '198.51.100.2')])
        for client in (a, b):
            assert client.req('/api/saves')[0] == 200
            for i in range(3): assert client.save(i) == 200
            assert client.save(99) == 429
        assert set(server._save_hits) == {'198.51.100.1', '198.51.100.2'}

        # Malformed/duplicate/missing X-Real-IP falls back, and XFF stays ignored.
        server._save_hits['127.0.0.1'] = [server.time.time()] * 3
        invalid_headers = [[], [('X-Forwarded-For', '198.51.100.3')],
                           [('X-Real-IP', '')], [('X-Real-IP', 'not-an-ip')],
                           [('X-Real-IP', '198.51.100.3, 198.51.100.4')],
                           [('X-Real-IP', '198.51.100.3:1234')],
                           [('X-Real-IP', 'fe80::1%eth0')],
                           [('X-Real-IP', '198.51.100.3'), ('X-Real-IP', '198.51.100.4')]]
        for headers in invalid_headers:
            c = Client(headers); assert c.req('/api/saves')[0] == 200
            assert c.save(99) == 429, headers
        c = Client([('X-Real-IP', '198.51.100.1'), ('X-Forwarded-For', '203.0.113.99')])
        assert c.req('/api/saves')[0] == 200 and c.save(99) == 429
        assert server._canonical_ip('2001:0db8::1') == '2001:db8::1'
        assert server._canonical_ip('::ffff:198.51.100.1') == '198.51.100.1'
        print('PASS: trusted proxy separation; malformed/duplicate headers fail closed; XFF ignored')

        # Feedback uses the same proxy-aware key, while preserving its lower limit.
        server._hits.clear()
        for client in (a, b):
            for i in range(2):
                assert client.req('/api/feedback', 'POST', {'text': 'synthetic feedback'})[0] == 200
            assert client.req('/api/feedback', 'POST', {'text': 'synthetic feedback'})[0] == 429
        assert set(server._hits) == {'198.51.100.1', '198.51.100.2'}
        print('PASS: feedback limits remain enforced independently behind the proxy')

        # Ten browsers use identical filenames concurrently with isolated contents.
        server._save_hits.clear()
        clients = [Client([('X-Real-IP', f'192.0.2.{i + 1}')]) for i in range(10)]
        for client in clients:
            assert client.req('/api/saves')[0] == 200
        assert len({client.cookie for client in clients}) == 10
        with ThreadPoolExecutor(max_workers=10) as pool:
            statuses = list(pool.map(lambda item: item[1].save(item[0] + 100), enumerate(clients)))
        assert statuses == [200] * 10
        for i, client in enumerate(clients):
            assert json.loads(client.req('/api/saves/autosave')[1])['game']['day'] == i + 100
            assert len(json.loads(client.req('/api/saves')[1])['saves']) == 1
        assert clients[0].req('/api/saves/autosave', 'DELETE')[0] == 200
        assert clients[0].req('/api/saves/autosave')[0] == 404
        for i, client in enumerate(clients[1:], 1):
            assert json.loads(client.req('/api/saves/autosave')[1])['game']['day'] == i + 100
        # Even a trusted IP cannot select someone else's namespace without their cookie.
        clients[0].headers = list(clients[1].headers)
        assert clients[0].req('/api/saves/autosave')[0] == 404
        assert clients[0].req('/api/saves/autosave?owner=' + clients[1].cookie.split('=')[1])[0] == 404
        print('PASS: ten concurrent browser saves; same-name read/list/delete isolation')
    finally:
        srv.shutdown(); srv.server_close(); thread.join()
