import importlib.util
import http.client
import json
import tempfile
import threading
from functools import partial
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('admin_server', Path(__file__).with_name('serve-admin.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
handler = module.AdminHandler.__new__(module.AdminHandler)
with tempfile.TemporaryDirectory() as folder:
    handler.directory = folder
    target = Path(folder) / 'auth/callback.html'
    target.parent.mkdir()
    target.write_text('callback')
    assert handler.translate_path('/auth/callback?code=test') == str(target)
    assert handler.translate_path('/missing') == str(Path(folder) / 'missing')
    assert handler.translate_path('/../../auth/callback') == str(target)
    (Path(folder) / 'index.html').write_text('admin')
    (Path(folder) / 'entry.js').write_text('window.admin = true;')
    server = module.ThreadingHTTPServer(('127.0.0.1', 0), partial(module.AdminHandler, directory=folder))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    with server, patch.object(module, 'connection_status', return_value={'connected': False, 'expires_at': None}), \
            patch.object(module, 'connect', side_effect=AssertionError('Unexpected session write')), \
            patch.object(module, 'disconnect', side_effect=AssertionError('Unexpected session deletion')):
        thread.start()
        connection = http.client.HTTPConnection(*server.server_address, timeout=3)
        origin = 'http://127.0.0.1:' + str(server.server_port)
        try:
            for method, path, headers, status, expected in [
                ('GET', '/', {}, 200, b'admin'),
                ('HEAD', '/', {}, 200, b''),
                ('GET', '/auth/callback?code=test', {}, 200, b'callback'),
                ('GET', '/entry.js', {}, 200, b'window.admin = true;'),
                ('GET', '/', {'If-Modified-Since': 'Thu, 01 Jan 2099 00:00:00 GMT'}, 304, b''),
                ('GET', '/auth', {}, 301, b''),
                ('GET', '/missing', {}, 404, None),
                ('GET', '/api/ai-session', {}, 200, {'connected': False, 'expires_at': None}),
                ('POST', '/api/ai-session', {'Origin': 'https://evil.example'}, 403, {'error': 'SAME_ORIGIN_REQUIRED'}),
                ('DELETE', '/api/ai-session', {'Origin': 'https://evil.example'}, 403, {'error': 'SAME_ORIGIN_REQUIRED'}),
                ('POST', '/api/ai-session', {'Origin': origin, 'Content-Type': 'application/json'}, 400, {'error': 'INVALID_ADMIN_SESSION'}),
                ('POST', '/api/absent', {}, 404, {'error': 'NOT_FOUND'}),
            ]:
                connection.request(method, path, headers=headers)
                response = connection.getresponse()
                body = response.read()
                assert response.status == status, (method, path, response.status)
                assert response.getheader('Cache-Control') == 'no-store'
                policies = {parts[0]: parts[1:] for rule in response.getheader('Content-Security-Policy', '').split(';') if (parts := rule.split())}
                assert policies.get('frame-ancestors') == ["'none'"], (method, path, policies)
                assert policies.get('object-src') == ["'none'"]
                assert policies.get('base-uri') == ["'self'"]
                assert response.getheader('X-Frame-Options') == 'DENY'
                assert response.headers.get_all('X-Content-Type-Options') == ['nosniff']
                assert response.getheader('Referrer-Policy') == 'strict-origin-when-cross-origin'
                assert response.getheader('Access-Control-Allow-Origin') is None
                if isinstance(expected, dict):
                    assert json.loads(body) == expected
                    assert response.getheader('Content-Type') == 'application/json; charset=utf-8'
                elif expected is not None:
                    assert body == expected
                if path == '/entry.js':
                    assert response.getheader('Content-Type') in ('text/javascript', 'application/javascript')
        finally:
            connection.close()
            server.shutdown()
            thread.join(timeout=3)
print('Clean callbacks, static/API security headers and same-origin session guards passed')
