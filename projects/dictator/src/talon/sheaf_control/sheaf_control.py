from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from urllib import request

from talon import actions, app, scope


HOST = "127.0.0.1"
PORT = 28579
BRIDGE_NAME = "sheaf_talon_control"
BRIDGE_VERSION = "1.0"


def _status_body():
    modes = sorted(scope.get("mode") or [])
    speech_enabled = bool(actions.speech.enabled())
    return {
        "available": True,
        "bridge": BRIDGE_NAME,
        "version": BRIDGE_VERSION,
        "speech_enabled": speech_enabled,
        "mode": modes,
    }


class _Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class _Handler(BaseHTTPRequestHandler):
    server_version = "SheafTalonControl/1.0"

    def do_GET(self):
        if self.path != "/status":
            self._send_json(404, {"error": "Not found."})
            return
        self._send_json(200, _status_body())

    def do_POST(self):
        if self.path == "/sleep":
            actions.speech.disable()
            self._send_json(200, _status_body())
            return
        if self.path == "/wake":
            actions.speech.enable()
            self._send_json(200, _status_body())
            return
        self._send_json(404, {"error": "Not found."})

    def log_message(self, format, *args):
        return

    def _send_json(self, status, body):
        data = json.dumps(body, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def _existing_bridge_running():
    try:
        with request.urlopen(f"http://{HOST}:{PORT}/status", timeout=0.2) as response:
            body = json.loads(response.read().decode("utf-8"))
            return body.get("bridge") == BRIDGE_NAME
    except Exception:
        return False


def _start_server():
    try:
        server = _Server((HOST, PORT), _Handler)
    except OSError as error:
        if _existing_bridge_running():
            print(f"Sheaf Talon bridge already listening on http://{HOST}:{PORT}")
            return
        app.notify(title="Sheaf Talon bridge failed", body=str(error))
        print(f"Sheaf Talon bridge failed to bind {HOST}:{PORT}: {error}")
        return

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Sheaf Talon bridge listening on http://{HOST}:{PORT}")


_start_server()
