import importlib.util
import http.server
import json
import sys
import threading
import types
import unittest
from pathlib import Path


BRIDGE_PATH = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "talon"
    / "sheaf_control"
    / "sheaf_control.py"
)


class FakeSpeech:
    def __init__(self, enabled=True):
        self._enabled = enabled
        self.disable_count = 0
        self.enable_count = 0

    def enabled(self):
        return self._enabled

    def disable(self):
        self.disable_count += 1
        self._enabled = False

    def enable(self):
        self.enable_count += 1
        self._enabled = True


class FakeThreadingHTTPServer:
    allow_reuse_address = False
    daemon_threads = False

    def __init__(self, address, handler):
        self.address = address
        self.handler = handler

    def serve_forever(self):
        return


class SheafControlTests(unittest.TestCase):
    def load_bridge(self, speech_enabled=True):
        fake_speech = FakeSpeech(speech_enabled)
        fake_actions = types.SimpleNamespace(speech=fake_speech)
        fake_app = types.SimpleNamespace(notify=lambda **_: None)
        fake_scope = types.SimpleNamespace(get=lambda name: ["command"] if fake_speech.enabled() else ["sleep"])

        callbacks = {}
        fake_speech_system = types.SimpleNamespace(
            register=lambda name, callback: callbacks.setdefault(name, callback)
        )
        fake_talon = types.SimpleNamespace(
            actions=fake_actions,
            app=fake_app,
            scope=fake_scope,
            speech_system=fake_speech_system,
        )

        original_talon = sys.modules.get("talon")
        original_http_server = http.server.ThreadingHTTPServer
        sys.modules["talon"] = fake_talon
        http.server.ThreadingHTTPServer = FakeThreadingHTTPServer
        module_name = f"sheaf_control_under_test_{id(self)}_{len(sys.modules)}"
        try:
            spec = importlib.util.spec_from_file_location(module_name, BRIDGE_PATH)
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
        finally:
            if original_talon is None:
                sys.modules.pop("talon", None)
            else:
                sys.modules["talon"] = original_talon
            http.server.ThreadingHTTPServer = original_http_server

        return module, fake_speech, callbacks

    def test_sleep_completes_after_post_phrase(self):
        bridge, speech, callbacks = self.load_bridge()
        bridge.SLEEP_FALLBACK_SECONDS = 10

        completed = {}
        thread = threading.Thread(target=lambda: completed.setdefault("body", bridge._sleep_and_status()))
        thread.start()

        self.assertTrue(bridge._pending_sleep.event.wait(0.1))
        self.assertTrue(speech.enabled())

        callbacks["post:phrase"]({})
        thread.join(1)

        self.assertFalse(thread.is_alive())
        self.assertFalse(speech.enabled())
        self.assertEqual(speech.disable_count, 1)
        self.assertEqual(completed["body"]["speech_enabled"], False)

    def test_sleep_completes_after_fallback_timeout(self):
        bridge, speech, _callbacks = self.load_bridge()
        bridge.SLEEP_FALLBACK_SECONDS = 0.01

        body = bridge._sleep_and_status()

        self.assertFalse(speech.enabled())
        self.assertEqual(speech.disable_count, 1)
        self.assertEqual(body["speech_enabled"], False)

    def test_duplicate_sleep_requests_join_pending_sleep(self):
        bridge, speech, callbacks = self.load_bridge()
        bridge.SLEEP_FALLBACK_SECONDS = 10

        results = []
        threads = [
            threading.Thread(target=lambda: results.append(bridge._sleep_and_status())),
            threading.Thread(target=lambda: results.append(bridge._sleep_and_status())),
        ]
        for thread in threads:
            thread.start()

        self.assertTrue(bridge._pending_sleep.event.wait(0.1))
        callbacks["post:phrase"]({})
        for thread in threads:
            thread.join(1)

        self.assertEqual(len(results), 2)
        self.assertFalse(speech.enabled())
        self.assertEqual(speech.disable_count, 1)

    def test_sleep_already_asleep_returns_immediately(self):
        bridge, speech, _callbacks = self.load_bridge(speech_enabled=False)
        bridge.SLEEP_FALLBACK_SECONDS = 10

        body = bridge._sleep_and_status()

        self.assertFalse(speech.enabled())
        self.assertEqual(speech.disable_count, 0)
        self.assertEqual(body["speech_enabled"], False)

    def test_wake_clears_pending_sleep(self):
        bridge, speech, _callbacks = self.load_bridge()
        bridge.SLEEP_FALLBACK_SECONDS = 10

        thread = threading.Thread(target=bridge._sleep_and_status)
        thread.start()
        self.assertTrue(bridge._pending_sleep.event.wait(0.1))

        body = bridge._wake_and_status()
        thread.join(1)

        self.assertFalse(thread.is_alive())
        self.assertTrue(speech.enabled())
        self.assertEqual(speech.enable_count, 1)
        self.assertEqual(body["speech_enabled"], True)


if __name__ == "__main__":
    unittest.main()
