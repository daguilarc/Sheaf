# Quest Runner Registry Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the Quest Runner service bind to its registered endpoint by default, fail on an invalid or missing registry entry, and remove the misleading generic service assignment on port `9000`.

**Architecture:** Keep endpoint loading in `quest_runner_service.__main__`, where the source repository root is already resolved. A small pure resolver reads and validates exactly one `quest-runner` entry, applies per-field CLI overrides, and returns the final `(host, port)` pair used by logging and Flask. The launcher delegates endpoint choice to the service.

**Tech Stack:** Python 3.10+, `argparse`, standard-library `json`, `unittest`, Bash, Markdown/OpenSpec.

## Global Constraints

- Do not change Agent VM `9000-9009` forwarding configuration, code, specifications, documentation, or tests.
- `config/services.json` is authoritative for the Quest Runner service bind endpoint.
- Startup fails rather than falling back when the registry file or `quest-runner` endpoint is invalid.
- Explicit `--host` and `--port` values override only their corresponding registered fields.
- The operator CLI's client-side fallback `http://localhost:9002` remains unchanged.
- A valid port is an integer from `1` through `65535`; booleans are invalid.

---

### Task 1: Strict Registry Endpoint Resolution

**Files:**
- Modify: `projects/quest-runner/tests/test_service_entrypoint.py`
- Modify: `projects/quest-runner/src/quest_runner_service/__main__.py`
- Modify: `projects/quest-runner/start_quest_runner.sh`

**Interfaces:**
- Consumes: `_resolve_source_repo_root() -> Path` and `<repo>/config/services.json`.
- Produces: `ServiceEndpointError`, `_resolve_bind_endpoint(repo_root: Path, cli_host: str | None = None, cli_port: int | None = None) -> tuple[str, int]`.

- [x] **Step 1: Add failing tests for registered defaults and per-field overrides**

Add these imports and test class to `projects/quest-runner/tests/test_service_entrypoint.py`:

```python
import json
import tempfile

from quest_runner_service.__main__ import (
    ServiceEndpointError,
    _resolve_bind_endpoint,
)


class BindEndpointResolutionTests(unittest.TestCase):
    def _repo(self, services: object) -> tempfile.TemporaryDirectory[str]:
        temporary = tempfile.TemporaryDirectory()
        config_dir = Path(temporary.name) / "config"
        config_dir.mkdir()
        (config_dir / "services.json").write_text(
            json.dumps(services),
            encoding="utf-8",
        )
        return temporary

    def test_uses_registered_endpoint_by_default(self) -> None:
        with self._repo([
            {"name": "quest-runner", "host": "0.0.0.0", "port": 9002}
        ]) as repo:
            endpoint = _resolve_bind_endpoint(Path(repo))
        self.assertEqual(endpoint, ("0.0.0.0", 9002))

    def test_cli_overrides_apply_per_field(self) -> None:
        with self._repo([
            {"name": "quest-runner", "host": "0.0.0.0", "port": 9002}
        ]) as repo:
            host_override = _resolve_bind_endpoint(Path(repo), cli_host="127.0.0.1")
            port_override = _resolve_bind_endpoint(Path(repo), cli_port=9100)
        self.assertEqual(host_override, ("127.0.0.1", 9002))
        self.assertEqual(port_override, ("0.0.0.0", 9100))
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd projects/quest-runner
PYTHONPATH=src .venv/bin/python -m unittest \
  tests.test_service_entrypoint.BindEndpointResolutionTests -v
```

Expected: import failure because `ServiceEndpointError` and `_resolve_bind_endpoint` do not exist.

- [x] **Step 3: Add failing tests for every startup rejection**

Add these methods to `BindEndpointResolutionTests`:

```python
    def test_missing_registry_fails(self) -> None:
        with tempfile.TemporaryDirectory() as repo:
            with self.assertRaisesRegex(ServiceEndpointError, "services.json is missing"):
                _resolve_bind_endpoint(Path(repo))

    def test_malformed_or_non_array_registry_fails(self) -> None:
        with tempfile.TemporaryDirectory() as repo:
            config_dir = Path(repo) / "config"
            config_dir.mkdir()
            services_path = config_dir / "services.json"
            services_path.write_text("not-json", encoding="utf-8")
            with self.assertRaisesRegex(ServiceEndpointError, "invalid JSON"):
                _resolve_bind_endpoint(Path(repo))
            services_path.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ServiceEndpointError, "must contain an array"):
                _resolve_bind_endpoint(Path(repo))

    def test_missing_or_duplicate_entry_fails(self) -> None:
        with self._repo([]) as repo:
            with self.assertRaisesRegex(ServiceEndpointError, "is not registered"):
                _resolve_bind_endpoint(Path(repo))
        duplicate = {"name": "quest-runner", "host": "0.0.0.0", "port": 9002}
        with self._repo([duplicate, duplicate]) as repo:
            with self.assertRaisesRegex(ServiceEndpointError, "registered more than once"):
                _resolve_bind_endpoint(Path(repo))

    def test_invalid_registered_host_or_port_fails(self) -> None:
        invalid_entries = [
            ({"name": "quest-runner", "host": " ", "port": 9002}, "invalid host"),
            ({"name": "quest-runner", "host": "0.0.0.0", "port": True}, "invalid port"),
            ({"name": "quest-runner", "host": "0.0.0.0", "port": 0}, "invalid port"),
            ({"name": "quest-runner", "host": "0.0.0.0", "port": 65536}, "invalid port"),
        ]
        for entry, message in invalid_entries:
            with self.subTest(entry=entry):
                with self._repo([entry]) as repo:
                    with self.assertRaisesRegex(ServiceEndpointError, message):
                        _resolve_bind_endpoint(Path(repo))

    def test_invalid_cli_overrides_fail(self) -> None:
        entry = {"name": "quest-runner", "host": "0.0.0.0", "port": 9002}
        with self._repo([entry]) as repo:
            with self.assertRaisesRegex(ServiceEndpointError, "invalid host"):
                _resolve_bind_endpoint(Path(repo), cli_host=" ")
            with self.assertRaisesRegex(ServiceEndpointError, "invalid port"):
                _resolve_bind_endpoint(Path(repo), cli_port=65536)
```

- [x] **Step 4: Implement the minimal strict resolver**

In `projects/quest-runner/src/quest_runner_service/__main__.py`, import `json` and add:

```python
class ServiceEndpointError(RuntimeError):
    """Raised when Quest Runner cannot resolve a valid registered endpoint."""


def _validate_endpoint(host: object, port: object) -> tuple[str, int]:
    if not isinstance(host, str) or not host.strip():
        raise ServiceEndpointError("quest-runner service has invalid host")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
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
```

Change the parser defaults to `None`, resolve the endpoint after deriving the
repository root, and use it for logging and Flask:

```python
    parser.add_argument("--port", type=int, default=None, help="HTTP server port override")
    parser.add_argument("--host", default=None, help="HTTP bind host override")
```

```python
    source_repo_root = _resolve_source_repo_root()
    try:
        bind_host, bind_port = _resolve_bind_endpoint(
            source_repo_root,
            cli_host=args.host,
            cli_port=args.port,
        )
    except ServiceEndpointError as exc:
        parser.error(str(exc))
```

```python
    endpoint = f"http://{bind_host}:{bind_port}"
```

```python
    app.run(host=bind_host, port=bind_port)
```

- [x] **Step 5: Run the resolver tests and verify GREEN**

Run the focused test command from Step 2.

Expected: all `BindEndpointResolutionTests` pass.

- [x] **Step 6: Add and verify the launcher regression test**

Add to `ServiceEntrypointTests`:

```python
    def test_launcher_does_not_override_registered_port(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        launcher = (project_root / "start_quest_runner.sh").read_text(encoding="utf-8")
        self.assertNotIn("--port 9002", launcher)
```

Run the single test and verify it fails because the launcher still contains
`--port 9002`:

```bash
cd projects/quest-runner
PYTHONPATH=src .venv/bin/python -m unittest \
  tests.test_service_entrypoint.ServiceEntrypointTests.test_launcher_does_not_override_registered_port -v
```

Then change the launcher invocation to:

```bash
exec "${VENV_DIR}/bin/python" -m quest_runner_service \
  >>"${STDOUT_LOG}" 2>>"${STDERR_LOG}"
```

Rerun the single test. Expected: PASS.

- [x] **Step 7: Run the complete entrypoint module**

Run:

```bash
cd projects/quest-runner
PYTHONPATH=src .venv/bin/python -m unittest tests.test_service_entrypoint -v
```

Expected: all entrypoint tests pass with no errors or warnings.

- [x] **Step 8: Commit the runtime change**

```bash
git add projects/quest-runner/tests/test_service_entrypoint.py \
  projects/quest-runner/src/quest_runner_service/__main__.py \
  projects/quest-runner/start_quest_runner.sh
git commit -m "Use registered Quest Runner endpoint"
```

---

### Task 2: Reconcile Service Documentation and OpenSpec

**Files:**
- Modify: `structure/services.md`
- Modify: `projects/quest-runner/docs/operations.md`
- Modify: `projects/quest-runner/README.md`
- Modify: `openspec/specs/quest-runner-service-lifecycle/spec.md`

**Interfaces:**
- Consumes: `_resolve_bind_endpoint(...)` behavior from Task 1.
- Produces: one consistent written contract: registry defaults, strict startup failure, per-field CLI overrides.

- [x] **Step 1: Replace the invented service assignment**

In `structure/services.md`, replace the generic `example` object with the real
Quest Runner entry from `config/services.json`:

```json
{
  "name": "quest-runner",
  "host": "0.0.0.0",
  "port": 9002,
  "command": "make quest-runner-run",
  "home_path": "/dashboard"
}
```

Replace the later `127.0.0.1:9000` URL example with the Quest Runner dashboard
at `http://127.0.0.1:9002/dashboard`, explaining that clients use a reachable
loopback address for a service bound to `0.0.0.0`.

- [x] **Step 2: Update Quest Runner operations and README language**

In `projects/quest-runner/docs/operations.md`, replace the direct command that
passes `--port 9002` with:

```bash
.venv/bin/python -m quest_runner_service
```

State that startup reads `config/services.json`, uses the `quest-runner` host
and port, fails when that endpoint is invalid or missing, and permits explicit
per-field `--host`/`--port` overrides.

In `projects/quest-runner/README.md`, change “The service listens on port
`9002`” to “The registered service listens on port `9002` by default.”

- [x] **Step 3: Rewrite the OpenSpec lifecycle requirements**

In `openspec/specs/quest-runner-service-lifecycle/spec.md`:

- Change svc-3 so `python -m quest_runner_service` loads the `quest-runner`
  registry host/port, fails for missing/invalid/duplicate registration, and
  applies `--host`/`--port` as per-field overrides.
- Change svc-5 so the launcher invokes the module without a hard-coded port.
- Keep svc-7's canonical `9002` registry object and svc-8's client fallback.
- Change the process-flags contract so absent flags use registry values rather
  than built-in defaults.
- Replace the design statement that the service does not read the registry with
  the strict resolver behavior implemented in Task 1.

- [x] **Step 4: Run static contract checks**

Run:

```bash
rg -n 'port": 9000|127\.0\.0\.1:9000' structure/services.md
rg -n -- '--port 9002' projects/quest-runner/start_quest_runner.sh \
  projects/quest-runner/docs/operations.md \
  openspec/specs/quest-runner-service-lifecycle/spec.md
rg -n 'does not read.*services\.json|defaults.*9002|default `9002`' \
  openspec/specs/quest-runner-service-lifecycle/spec.md
```

Expected: all three searches produce no matches. Do not run a repository-wide
`9000` replacement; the Agent VM range is intentionally unchanged.

- [x] **Step 5: Validate OpenSpec and formatting**

Run:

```bash
openspec validate --all
git diff --check
```

Expected: both commands exit 0.

- [x] **Step 6: Commit the contract changes**

```bash
git add structure/services.md \
  projects/quest-runner/docs/operations.md \
  projects/quest-runner/README.md \
  openspec/specs/quest-runner-service-lifecycle/spec.md
git commit -m "Align Quest Runner endpoint documentation"
```

---

### Task 3: Full Verification

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: runtime and written-contract changes from Tasks 1 and 2.
- Produces: fresh completion evidence.

- [x] **Step 1: Run the complete Quest Runner unit suite**

Run:

```bash
make -C projects/quest-runner test
```

Expected: exit 0 with every configured unittest module passing.

Execution note: the suite ran 468 tests; 467 passed and the sole error was the
approved pre-existing `test_public_docs_describe_workflow_and_issue_file`
failure, which still references the removed
`projects/quest-runner/docs/capabilities/experiments.md` file. The endpoint
change introduced no additional full-suite failures.

- [x] **Step 2: Verify the intended port inventory**

Run:

```bash
jq -r '.[] | [.name, (.port|tostring)] | @tsv' config/services.json
rg -n '9000-9009' config/quest-runner.json \
  projects/quest-runner/src/quest_runner_service/agent_vm.py \
  openspec/specs/quest-runner-agent-harness/spec.md \
  projects/quest-runner/docs/operations.md
git status --short
```

Expected: the registry prints Conductor `9001`, Quest Runner `9002`, Dictator
`9003`, and Sheaf Chat `9004`; Agent VM range matches remain present; status
contains only the implementation-plan file if it has not yet been committed.

- [x] **Step 3: Commit the implementation plan if still uncommitted**

```bash
git add docs/superpowers/plans/2026-07-15-quest-runner-registry-endpoint.md
git commit -m "Document Quest Runner endpoint implementation"
```
