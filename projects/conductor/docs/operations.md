# Conductor Operations

Normative procedures to build, run, test, and stop conductor from a fresh
checkout. All commands run from the repository root unless noted.

## Prerequisites

- Node.js >= 20 with `npm` on `PATH`.
- A repository checkout containing `config/services.json` and `structure/`
  at the root — conductor discovers the repo root by finding both, and the
  test suite reads the real registry.
- The registry must contain a `conductor` entry
  ([structure/services.md](../../../structure/services.md)); the checked-in
  entry is:

```json
{
  "name": "conductor",
  "host": "0.0.0.0",
  "port": 9001,
  "home_path": "/",
  "command": "make conductor-run"
}
```

## Build

```bash
npm --prefix projects/conductor install
npm --prefix projects/conductor run build
```

`run build` invokes `tsc` and emits `projects/conductor/dist/`. Equivalent
Make targets: `make -C projects/conductor install` and
`make -C projects/conductor build` (or `make conductor-build` from the repo
root, which does not install).

## Run

The build step must have been run first — both run paths execute the compiled
`dist/src/main.js` and do not rebuild.

Background (the registered way, logs to files):

```bash
make conductor-run
```

This runs `make -C projects/conductor run` →
`projects/conductor/start_conductor.sh`, which appends process output to
`logs/conductor/conductor_stdout.log` and
`logs/conductor/conductor_stderr.log` (directory created if missing) and
exits 127 if `node` is not on `PATH`.

Foreground (logs to the terminal):

```bash
npm --prefix projects/conductor start
```

On success conductor prints `Conductor listening on <host>:<port>` to stderr
and binds the host and port of the `conductor` registry entry (currently
`0.0.0.0:9001`). The UI is then at `http://127.0.0.1:9001/`. There are no
CLI flags or environment-variable overrides.

## Smoke-test launches

The lifecycle endpoints accept an optional JSON body to launch a service in
smoke-test mode:

```bash
curl -X POST http://127.0.0.1:9001/api/services/dictator/restart \
  -H "Content-Type: application/json" \
  -d '{"smoke_test": true}'
```

`POST /api/services/<name>/start` and `/api/services/<name>/restart` both honor
`{"smoke_test": true}`. When set, conductor discovers the main working tree (an
explicit `SHEAF_SMOKE_ASSET_ROOT` in conductor's own environment wins, otherwise
the parent of the shared `.git` from `git rev-parse --git-common-dir`, otherwise
conductor's own repo root) and spawns the service with `SHEAF_SMOKE_TEST_MODE=1`
and `SHEAF_SMOKE_ASSET_ROOT` set to that root. Without the flag (or with
`false`), the spawn environment is unchanged. The service then reads its
git-ignored assets from the asset root. See [structure/testing.md](../../../structure/testing.md)
and the `smoke-test` agent skill for the full flow.

## Stop

```bash
curl -X POST http://127.0.0.1:9001/exit
```

Responds `{"exiting": true}` and exits the process with code 0. The UI's
Stop/Restart buttons on the `conductor` row do the same thing.

## Test

```bash
npm --prefix projects/conductor test
```

This is the single test lane: `npm run build && node --test
dist/tests/*.test.js`. Equivalent: `make conductor-test` (repo root) or
`make -C projects/conductor test`. `make -C projects/conductor all` runs
install then test.

Tests bind ephemeral loopback ports, use injected fakes for outbound fetch
and process spawning, and create temp directories for log fixtures; they
require no running services and no network beyond loopback. `scaffold.test`
asserts the real `config/services.json` contains exactly the `conductor`
entry shown above — registry edits to that entry break the suite.

## Clean

```bash
make -C projects/conductor clean   # rm -rf dist
```

(`make conductor-clean` from the repo root is equivalent.)

## Runtime files

Conductor itself persists nothing. Services started through conductor get
their stdout/stderr appended to
`logs/<service_name>/<service_name>_stdout.log` and
`logs/<service_name>/<service_name>_stderr.log` under the repository root —
the same layout `start_conductor.sh` uses for conductor itself. Log viewing
reads from `logs/<service_name>/` (see
[log-access](../../../openspec/specs/conductor-log-access/spec.md)).
