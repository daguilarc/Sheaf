"""CLI entry point: python -m quest_runner_service"""

from __future__ import annotations

import argparse
import json
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


class ServiceEndpointError(RuntimeError):
    """Raised when Quest Runner cannot resolve a valid registered endpoint."""


def _validate_endpoint(host: object, port: object) -> tuple[str, int]:
    if not isinstance(host, str) or not host.strip():
        raise ServiceEndpointError("quest-runner service has invalid host")
    if (
        isinstance(port, bool)
        or not isinstance(port, int)
        or not 1 <= port <= 65535
    ):
        raise ServiceEndpointError("quest-runner service has invalid port")
    return host.strip(), port


def _resolve_bind_endpoint(
    repo_root: Path,
    cli_host: str | None = None,
    cli_port: int | None = None,
) -> tuple[str, int]:
    services_path = repo_root / "config" / "services.json"
    try:
        raw = json.loads(services_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ServiceEndpointError(f"services.json is missing: {services_path}") from exc
    except OSError as exc:
        raise ServiceEndpointError(f"could not read services.json: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ServiceEndpointError(f"services.json contains invalid JSON: {exc}") from exc
    if not isinstance(raw, list):
        raise ServiceEndpointError("services.json must contain an array")

    matches = [
        entry
        for entry in raw
        if isinstance(entry, dict) and entry.get("name") == "quest-runner"
    ]
    if not matches:
        raise ServiceEndpointError("quest-runner is not registered in config/services.json")
    if len(matches) > 1:
        raise ServiceEndpointError("quest-runner is registered more than once")

    registered_host, registered_port = _validate_endpoint(
        matches[0].get("host"),
        matches[0].get("port"),
    )
    return _validate_endpoint(
        registered_host if cli_host is None else cli_host,
        registered_port if cli_port is None else cli_port,
    )


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
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="HTTP server port override",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="HTTP bind host override",
    )
    args = parser.parse_args()

    source_repo_root = _resolve_source_repo_root()
    try:
        bind_host, bind_port = _resolve_bind_endpoint(
            source_repo_root,
            cli_host=args.host,
            cli_port=args.port,
        )
    except ServiceEndpointError as exc:
        parser.error(str(exc))
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

    endpoint = f"http://{bind_host}:{bind_port}"
    log.info(
        "Quest Runner ready on %s (source_repo=%s, log_dir=%s)",
        endpoint,
        source_repo_root,
        log_dir,
    )
    app.run(host=bind_host, port=bind_port)


if __name__ == "__main__":
    main()
