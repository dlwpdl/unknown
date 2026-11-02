"""Serve the private Expo export on this computer, including clean callback URLs."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import subprocess
from admin_merchant_gateway import connect, connection_status, disconnect, same_origin


def lookup_tailnet_host():
    """The name `tailscale serve` forwards as Host, looked up at start so it never lands in this public repo."""
    try:
        status = json.loads(subprocess.run(['tailscale', 'status', '--json'], capture_output=True, text=True, timeout=10).stdout)
        return status['Self']['DNSName'].rstrip('.') or None
    except Exception: return None  # No Tailscale: loopback only.


class AdminHandler(SimpleHTTPRequestHandler):
    tailnet_host = None

    def parse_request(self):
        # DNS rebinding: a hostile page resolved to 127.0.0.1 still sends its own Host, so every request is checked.
        if not super().parse_request(): return False
        host, port = self.headers.get('Host'), self.server.server_port
        if host and host in (f'127.0.0.1:{port}', f'localhost:{port}', self.tailnet_host): return True
        self.json_response(403, {'error': 'HOST_NOT_ALLOWED'})
        return False

    def json_response(self, status, value):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
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
        self.send_header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        super().end_headers()


if __name__ == '__main__':
    directory = Path(__file__).resolve().parents[1] / '.admin-dist'
    AdminHandler.tailnet_host = lookup_tailnet_host()
    print('Tailscale name allowed' if AdminHandler.tailnet_host else 'Tailscale name not found: loopback only', flush=True)
    # The page requests ~20 assets at once; the default listen backlog (5) drops some and Tailscale returns 502.
    ThreadingHTTPServer.request_queue_size = 128
    ThreadingHTTPServer(('127.0.0.1', 54321), partial(AdminHandler, directory=directory)).serve_forever()
