# Implementation complete

Slice `0004_cli` delivers the Quest Runner CLI and repository-root entrypoint.

## Delivered

- `projects/quest-runner/src/quest_runner_service/cli.py` — argparse CLI with injectable HTTP transport, service URL discovery (`--base-url`, `QUEST_RUNNER_URL`, `config/services.json`, fallback), human-readable and `--json` output.
- `projects/quest-runner/bin/quest-runner` — executable entrypoint adding `src` to `sys.path`.
- `scripts/quest-runner` — symlink to the bin script.
- `projects/quest-runner/tests/test_cli.py` — coverage for URL precedence, help text, all command endpoints/payloads, JSON output, HTTP/transport errors, local validation, and symlink resolution.
- `projects/quest-runner/Makefile` — includes `tests.test_cli`.

## Commands

Lifecycle: `create`, `run`. Manual operations: `advance`, `land`. Issues: `issues list|read|create|edit|respond|responses`.

## Validation

All 241 project tests pass (`make -C projects/quest-runner test`).
