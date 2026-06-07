"""CLI entry point: python -m quest_runner_service"""

from __future__ import annotations

import argparse
import logging
import os
import threading
import time
from pathlib import Path

from flask import Flask, jsonify

log = logging.getLogger("quest_runner")
_started_at = time.time()
_EXIT_DELAY_SECONDS = 0.1


def _exit_process() -> None:
    os._exit(0)


def _schedule_process_exit(delay: float = _EXIT_DELAY_SECONDS) -> None:
    timer = threading.Timer(delay, _exit_process)
    timer.daemon = True
    timer.start()


def create_app() -> Flask:
    app = Flask(__name__)

    @app.route("/health", methods=["GET"])
    def health() -> tuple[object, int]:
        return jsonify({
            "healthy": True,
            "uptime": round(time.time() - _started_at, 2),
        }), 200

    @app.route("/exit", methods=["POST"])
    def exit_service() -> tuple[object, int]:
        _schedule_process_exit()
        return jsonify({"status": "exiting"}), 200

    return app


def main() -> None:
    global _started_at
    parser = argparse.ArgumentParser(description="Quest Runner service")
    parser.add_argument("--port", type=int, default=9002, help="HTTP server port")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="HTTP bind host",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )
    _started_at = time.time()

    package_dir = Path(__file__).resolve().parent
    app = create_app()
    endpoint = f"http://{args.host}:{args.port}"
    log.info("Quest Runner ready on %s (package=%s)", endpoint, package_dir)
    app.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
