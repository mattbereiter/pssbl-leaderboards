"""Serve public/ for the Playwright tests.

Same as `python -m http.server`, but with a deep listen queue: parallel test workers open many
connections at once, and the stock backlog of 5 makes Windows refuse some of them. Like GitHub Pages,
it gzips responses when the browser asks; the compressed bytes are kept in memory, keyed by path and mtime,
so the multi-MB CSVs are compressed once per run instead of once per test.
"""
import functools, gzip, http.server, os, sys, threading

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
ZIP = ('.html', '.js', '.csv', '.json')
cache, lock = {}, threading.Lock()

class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256

    def handle_error(self, request, client_address):
        pass  # browsers drop connections when a test ends mid-download

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, 'index.html')
        if 'gzip' not in self.headers.get('Accept-Encoding', '') or not path.endswith(ZIP) or not os.path.isfile(path):
            return super().do_GET()
        key = (path, os.path.getmtime(path))
        with lock:
            body = cache.get(key)
        if body is None:
            with open(path, 'rb') as f:
                body = gzip.compress(f.read(), 6)
            with lock:
                cache[key] = body
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
Server(('127.0.0.1', port), functools.partial(Quiet, directory=ROOT)).serve_forever()
