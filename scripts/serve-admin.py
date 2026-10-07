"""Serve the private Expo export on this computer, including clean callback URLs."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
from admin_merchant_gateway import connect, connection_status, disconnect, same_origin


class AdminHandler(SimpleHTTPRequestHandler):
    def json_response(self, status, value):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())

    def do_GET(self):
        if self.path == '/api/ai-session':
            self.json_response(200, connection_status())
        else: super().do_GET()

    def do_POST(self):
        if self.path != '/api/ai-session': return self.json_response(404, {'error': 'NOT_FOUND'})
        if not same_origin(self.headers.get('Origin', ''), self.headers.get('Host', '')):
            return self.json_response(403, {'error': 'SAME_ORIGIN_REQUIRED'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 30000 or self.headers.get_content_type() != 'application/json':
                return self.json_response(400, {'error': 'INVALID_ADMIN_SESSION'})
            self.json_response(200, connect(json.loads(self.rfile.read(size))))
        except Exception:
            self.json_response(403, {'error': 'MFA_ADMIN_CONNECTION_REQUIRED'})

    def do_DELETE(self):
        if self.path != '/api/ai-session': return self.json_response(404, {'error': 'NOT_FOUND'})
        if not same_origin(self.headers.get('Origin', ''), self.headers.get('Host', '')):
            return self.json_response(403, {'error': 'SAME_ORIGIN_REQUIRED'})
        try:
            disconnect(); self.json_response(200, {'connected': False, 'expires_at': None})
        except Exception:
            self.json_response(503, {'error': 'AI_DISCONNECT_FAILED'})

    def translate_path(self, path):
        target = super().translate_path(path)
        return target + '.html' if Path(target + '.html').is_file() else target

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    directory = Path(__file__).resolve().parents[1] / '.admin-dist'
    ThreadingHTTPServer(('127.0.0.1', 54321), partial(AdminHandler, directory=directory)).serve_forever()
