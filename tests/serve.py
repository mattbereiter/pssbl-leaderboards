"""Serve public/ for the Playwright tests.

Same as `python -m http.server`, but with a deep listen queue: parallel test workers open many
connections at once, and the stock backlog of 5 makes Windows refuse some of them.
"""
import functools, http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')

class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256

    def handle_error(self, request, client_address):
        pass  # browsers drop connections when a test ends mid-download

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
Server(('127.0.0.1', port), functools.partial(Quiet, directory=ROOT)).serve_forever()
