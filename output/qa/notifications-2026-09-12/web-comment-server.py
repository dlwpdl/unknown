from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote
import argparse
args=argparse.ArgumentParser(description='Isolated Gling public-export QA; no external connections or real account data.')
args.add_argument('--export',required=True,type=Path)
args.add_argument('--port',default=8189,type=int)
options=args.parse_args()
ROOT=options.export
MOCK=Path(__file__).with_name('web-comment-mock.js').read_text()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def do_GET(self):
        route=unquote(urlparse(self.path).path)
        if route.startswith('/post/') or route=='/profile/notifications':
            path=ROOT/('post/[id].html' if route.startswith('/post/') else 'profile/notifications.html')
            body=path.read_text().replace('<head>','<head><script>'+MOCK+'</script>',1).encode()
            self.send_response(200); self.send_header('Content-type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.end_headers();self.wfile.write(body)
        else:super().do_GET()
    def end_headers(self):
        self.send_header('Content-Security-Policy',"connect-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: blob:; font-src 'self' data:")
        super().end_headers()
ThreadingHTTPServer(('127.0.0.1',options.port),Handler).serve_forever()
