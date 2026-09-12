"""Serve the private Expo export on this computer, including clean callback URLs."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class AdminHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        target = super().translate_path(path)
        return target + '.html' if Path(target + '.html').is_file() else target

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    directory = Path(__file__).resolve().parents[1] / '.admin-dist'
    ThreadingHTTPServer(('127.0.0.1', 54321), partial(AdminHandler, directory=directory)).serve_forever()
