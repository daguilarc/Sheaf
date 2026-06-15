"""CLI entry point: python -m quest_runner_service"""

from __future__ import annotations

import argparse
import logging
import os
import threading
import time
from pathlib import Path

from .api import create_app
from .logging_config import configure_service_logging
from .quest_lock import QuestLock
from .quest_service import QuestService
from .smoke_test import resolve_asset_root

log = logging.getLogger("quest_runner")
_EXIT_DELAY_SECONDS = 0.1


def _exit_process() -> None:
    os._exit(0)


def _schedule_process_exit(delay: float = _EXIT_DELAY_SECONDS) -> None:
    timer = threading.Timer(delay, _exit_process)
    timer.daemon = True
    timer.start()


def _resolve_source_repo_root() -> Path:
    package_dir = Path(__file__).resolve().parent
    return package_dir.parents[3]


def main() -> None:
    parser = argparse.ArgumentParser(description="Quest Runner service")
    parser.add_argument("--port", type=int, default=9002, help="HTTP server port")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="HTTP bind host",
    )
    args = parser.parse_args()

    source_repo_root = _resolve_source_repo_root()
    log_dir = source_repo_root / "logs" / "quest-runner"
    configure_service_logging(log_dir)

    asset_resolution = resolve_asset_root(source_repo_root, os.environ)
    if asset_resolution.warning is not None:
        log.warning("%s", asset_resolution.warning)
    elif asset_resolution.used_smoke_asset_root:
        log.info(
            "smoke-test mode: resolving git-ignored assets from %s",
            asset_resolution.asset_root,
        )

    started_at = time.time()
    quest_service = QuestService(QuestLock(), source_repo_root)
    app = create_app(
        quest_service=quest_service,
        source_repo_root=source_repo_root,
        started_at=started_at,
        shutdown_callback=_schedule_process_exit,
    )

    endpoint = f"http://{args.host}:{args.port}"
    log.info(
        "Quest Runner ready on %s (source_repo=%s, log_dir=%s)",
        endpoint,
        source_repo_root,
        log_dir,
    )
    app.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
