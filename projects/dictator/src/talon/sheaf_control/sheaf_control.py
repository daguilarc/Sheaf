from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from urllib import request

from talon import actions, app, scope, speech_system


HOST = "127.0.0.1"
PORT = 28579
BRIDGE_NAME = "sheaf_talon_control"
BRIDGE_VERSION = "1.0"
SLEEP_FALLBACK_SECONDS = 0.6

_sleep_lock = threading.RLock()
_pending_sleep = None


class _PendingSleep:
    def __init__(self):
        self.event = threading.Event()
        self.completed = threading.Event()
        self.timer = None
        self.canceled = False

    def start(self):
        self.timer = threading.Timer(SLEEP_FALLBACK_SECONDS, _complete_pending_sleep)
        self.timer.daemon = True
        self.timer.start()
        self.event.set()

    def cancel(self):
        self.canceled = True
        if self.timer:
            self.timer.cancel()
        self.completed.set()


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


def _sleep_and_status():
    if not actions.speech.enabled():
        return _status_body()

    pending = _begin_pending_sleep()
    pending.completed.wait()
    return _status_body()


def _wake_and_status():
    _cancel_pending_sleep()
    actions.speech.enable()
    return _status_body()


def _begin_pending_sleep():
    global _pending_sleep
    with _sleep_lock:
        if _pending_sleep is None or _pending_sleep.completed.is_set():
            _pending_sleep = _PendingSleep()
            _pending_sleep.start()
        return _pending_sleep


def _cancel_pending_sleep():
    global _pending_sleep
    with _sleep_lock:
        pending = _pending_sleep
        _pending_sleep = None
        if pending:
            pending.cancel()


def _complete_pending_sleep(_phrase=None):
    global _pending_sleep
    with _sleep_lock:
        pending = _pending_sleep
        if pending is None or pending.completed.is_set():
            return
        _pending_sleep = None
        if pending.timer:
            pending.timer.cancel()
        if not pending.canceled:
            actions.speech.disable()
        pending.completed.set()


speech_system.register("post:phrase", _complete_pending_sleep)


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
            self._send_json(200, _sleep_and_status())
            return
        if self.path == "/wake":
            self._send_json(200, _wake_and_status())
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
