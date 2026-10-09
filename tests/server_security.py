#!/usr/bin/env python3
"""Synthetic-only regression tests: storage isolation, GET/HEAD aliases and replay assets."""
import functools
import hashlib
import http.client
from http.cookies import SimpleCookie
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import threading
from urllib.parse import urljoin
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('banish_server', ROOT / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.base = ''; self.assets = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'base': self.base = a['href']
        if tag == 'script' and 'src' in a: self.assets.append(a['src'])
        if tag == 'link' and a.get('rel') == 'stylesheet': self.assets.append(a['href'])

with tempfile.TemporaryDirectory(prefix='banish-security-') as tmp:
    root = Path(tmp)
    for f in ('index.html', 'style.css'): shutil.copyfile(ROOT / f, root / f)
    for d in ('js', 'assets'): shutil.copytree(ROOT / d, root / d)
    fb, saves = root / 'feedback', root / 'saves'
    fb.mkdir(); saves.mkdir()
    legacy = b'{"synthetic":"legacy-keep"}'
    (saves / 'autosave.json').write_bytes(legacy)
    (fb / '.salt').write_text('synthetic-salt')
    (fb / 'feedback-200001.jsonl').write_text(json.dumps({'id':'fsynthetic', 'save': {'game': {'day':12}}}) + '\n')
    (root / 'js' / 'fb-alias').symlink_to(fb, target_is_directory=True)
    server.ROOT, server.FB_DIR, server.SAVES_DIR, server.TOKEN = str(root), str(fb), str(saves), 'test-only'
    server.COOKIE_SECURE = False
    srv = server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(server.Handler, directory=str(root)))
    thread = threading.Thread(target=srv.serve_forever, daemon=True); thread.start()
    class Client:
        def __init__(self): self.cookie = ''
        def req(self, path, method='GET', data=None, extra=None):
            h = {'Cookie': self.cookie}
            if data is not None: h['Content-Type'] = 'application/json'
            h.update(extra or {})
            c = http.client.HTTPConnection(*srv.server_address, timeout=5)
            c.request(method, path, json.dumps(data) if data is not None else None, h)
            r = c.getresponse(); cookie = r.getheader('Set-Cookie')
            if cookie:
                assert 'HttpOnly' in cookie and 'SameSite=Strict' in cookie
                self.cookie = cookie.split(';')[0]
            out = (r.status, r.read().decode()); c.close(); return out
    try:
        a, b, anon = Client(), Client(), Client()
        for c in (a,b): assert c.req('/api/saves') == (200, '{"ok": true, "saves": []}')
        assert a.cookie != b.cookie
        assert anon.req('/api/saves/autosave')[0] == 401
        assert anon.req('/api/saves/autosave', 'DELETE')[0] == 401
        assert anon.req('/api/saves', 'POST', {'name':'autosave','data':{}})[0] == 401
        for c,day in ((a,11),(b,22)):
            assert c.req('/api/saves','POST',{'name':'autosave','data':{'game':{'day':day}}})[0] == 200
        for c,day in ((a,11),(b,22)):
            assert json.loads(c.req('/api/saves/autosave')[1])['game']['day'] == day
            assert len(json.loads(c.req('/api/saves')[1])['saves']) == 1
        assert a.req('/api/saves/autosave','DELETE')[0] == 200
        assert b.req('/api/saves/autosave')[0] == 200
        assert (saves / 'autosave.json').read_bytes() == legacy
        # HTTPS reverse proxy must preserve public Host (including custom port).
        public = {'Host': 'game.example:8443', 'Origin': 'https://game.example:8443'}
        assert a.req('/api/saves', 'POST', {'name':'proxy','data':{}}, public)[0] == 200
        assert a.req('/api/saves/proxy', 'DELETE', extra=public)[0] == 200
        assert a.req('/api/saves','POST', {'name':'evil','data':{}}, {'Origin':'https://attacker.invalid'})[0] == 403
        assert a.req('/api/saves', extra={'Sec-Fetch-Site':'cross-site'})[0] == 403
        assert a.req('/api/saves','POST', {'name':'evil','data':{}}, {'Content-Type':'text/plain'})[0] == 415
        # Namespace selection ignores public owner IDs; missing/tampered cookies never access B.
        assert a.req('/api/saves/autosave?owner=' + b.cookie.split('=')[1])[0] == 404
        anon.cookie = 'banish_session=malformed'
        assert anon.req('/api/saves/autosave')[0] == 401
        anon.cookie = 'banish_session=' + '0'*64
        assert anon.req('/api/saves/autosave')[0] == 404
        bh = hashlib.sha256(b.cookie.split('=')[1].encode()).hexdigest()
        ah = hashlib.sha256(a.cookie.split('=')[1].encode()).hexdigest()
        ad = saves / '_sessions' / ah
        (ad/'escape.json').symlink_to(saves/'_sessions'/bh/'autosave.json')
        assert a.req('/api/saves/escape')[0] == 404
        assert a.req('/api/saves/escape','DELETE')[0] == 404
        assert a.req('/api/saves','POST',{'name':'escape','data':{}})[0] == 400
        assert json.loads(a.req('/api/saves')[1])['saves'] == []
        private = ['/feedback/.salt', '/%66eedback/feedback-200001.jsonl', '/js/%2e%2e/feedback/.salt',
                   '/feedback%2f.salt', '/js/fb-alias/feedback-200001.jsonl', '/saves/autosave.json',
                   '/saves/_sessions/'+bh+'/autosave.json', '/server.py', '/.git/config']
        for path in private:
            for method in ('GET','HEAD'): assert anon.req(path, method)[0] == 404, (path,method)
        # Implicit indexes must receive the same checks as direct file paths.
        for directory in ('js', 'assets'):
            index = root / directory / 'index.html'
            index.symlink_to(fb / '.salt')
            for method in ('GET', 'HEAD'):
                assert anon.req('/' + directory + '/', method)[0] == 404
            index.unlink()
        original_index = (root / 'index.html').read_bytes()
        (root / 'index.html').unlink()
        (root / 'index.html').symlink_to(fb / '.salt')
        for method in ('GET', 'HEAD'): assert anon.req('/', method)[0] == 404
        (root / 'index.html').unlink(); (root / 'index.html').write_bytes(original_index)
        for path in ('/','/style.css','/js/core.js'):
            assert anon.req(path)[0] == 200
        assert anon.req('/api/feedback')[0] == 403
        assert anon.req('/api/feedback?token=test-only')[0] == 200
        replay = '/api/feedback/fsynthetic/replay?token=test-only'
        status, html = anon.req(replay); assert status == 200 and '__REPLAY_SAVE' in html
        page = Page(); page.feed(html); assert page.base == '/'
        for asset in page.assets:
            path = urljoin(urljoin(replay,page.base),asset)
            assert anon.req(path)[0] == 200, path
        # Moving configured storage must not re-expose legacy default locations.
        server.FB_DIR = str(root/'new-feedback'); server.SAVES_DIR = str(root/'new-saves')
        assert anon.req('/feedback/.salt')[0] == 404
        assert anon.req('/saves/autosave.json')[0] == 404
        print('PASS: isolated clients, legacy preservation, ownership, CSRF, GET/HEAD aliases, replay assets')
    finally:
        srv.shutdown(); srv.server_close(); thread.join()
