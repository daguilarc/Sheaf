# Smoke Test

Use this skill to launch Sheaf services for human smoke testing from a feature
worktree, without hand-copying API keys or models out of the main checkout.

## What smoke-test mode does

Smoke-test mode is signalled by the `SHEAF_SMOKE_TEST_MODE` environment
variable. When it is active, each service resolves its git-ignored **assets**
(`config/api_keys.json`, `.secrets.json`, whisper/STT models under `models/`)
from the main-repo asset root given by `SHEAF_SMOKE_ASSET_ROOT`, while still
running the worktree's code and tracked config. This lets a worktree's services
run against real keys and models that live only in the main checkout.

You do not set these variables yourself. **Conductor** sets them: its lifecycle
API accepts an optional `smoke_test` flag, and when you pass it Conductor
discovers the main working tree and injects `SHEAF_SMOKE_TEST_MODE=1` and
`SHEAF_SMOKE_ASSET_ROOT` into the service it spawns.

## Important: a smoke restart replaces the service, not Conductor

Use the production Conductor already running on port 9001. Do not stop it and
do not start a second Conductor from the worktree. A smoke restart asks
production Conductor to stop the selected production-port service, then start
that service from the supplied worktree path.

Only one checkout can own these ports at a time. Do not run smoke launches from
multiple worktrees in parallel. The restarted services still use real API keys,
so this is for human-observed testing, not CI.

## Ready-to-run launch script

Run this from the worktree root. The script builds the worktree services, checks
that production Conductor is already healthy, then asks it to restart the
asset-dependent services from this worktree in smoke-test mode.

```bash
#!/usr/bin/env bash
set -euo pipefail

CONDUCTOR="http://127.0.0.1:9001"
SERVICES=(dictator sheaf-chat quest-runner)
REPO_ROOT="$(pwd)"
JSON_WORKTREE="$(printf '%s' "${REPO_ROOT}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"

if [[ ! -f "${REPO_ROOT}/config/services.json" ]]; then
  echo "Run this from the Sheaf worktree root." >&2
  exit 1
fi

echo "Building worktree services from ${REPO_ROOT}..."
make dictator-build sheaf-chat-build quest-runner-build

if ! curl -fsS "${CONDUCTOR}/health" >/dev/null 2>&1; then
  echo "Production Conductor is not healthy on ${CONDUCTOR}. Start it from the main checkout first." >&2
  exit 1
fi

for svc in "${SERVICES[@]}"; do
  echo "Restarting ${svc} from ${REPO_ROOT} in smoke-test mode..."
  curl -fsS -X POST "${CONDUCTOR}/api/services/${svc}/restart" \
    -H "Content-Type: application/json" \
    -d "{\"smoke_test\": true, \"worktree\": ${JSON_WORKTREE}}" >/dev/null
done

for svc in "${SERVICES[@]}"; do
  printf "Waiting for %s to be healthy" "${svc}"
  healthy=false
  for _ in $(seq 1 30); do
    if curl -fsS "${CONDUCTOR}/api/services/${svc}/health" \
      | grep -q '"healthy":true'; then
      healthy=true
      echo " ... healthy"
      break
    fi
    printf "."
    sleep 1
  done
  if [[ "${healthy}" != "true" ]]; then
    echo " ${svc} did not become healthy. Check logs/${svc}/." >&2
    exit 1
  fi
done

echo "Smoke services launched from ${REPO_ROOT}."
echo "Expected logs are under ${REPO_ROOT}/logs/<service>/."
```

To launch a single service, pass the worktree argument on that restart:

```bash
REPO_ROOT="$(pwd)"
JSON_WORKTREE="$(printf '%s' "${REPO_ROOT}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
curl -fsS -X POST "http://127.0.0.1:9001/api/services/dictator/restart" \
  -H "Content-Type: application/json" \
  -d "{\"smoke_test\": true, \"worktree\": ${JSON_WORKTREE}}"
```

## Verifying the origin

Service logs should appear under this worktree's `logs/<service>/` directories
after the restart. If logs only update under the main checkout, the restart did
not receive the intended `worktree` argument; rerun the request and inspect the
Conductor response before drawing conclusions from the smoke test.

## Restoring the production stack

When manual testing is done, ask production Conductor to restart the services
normally from its own checkout by omitting `smoke_test` and `worktree`:

```bash
for svc in dictator sheaf-chat quest-runner; do
  curl -fsS -X POST "http://127.0.0.1:9001/api/services/${svc}/restart" \
    -H "Content-Type: application/json" \
    -d '{}' >/dev/null
done
```

## Maintaining this skill

This Sheaf-only skill source lives at
`projects/agents/sheaf/skills/smoke-test/`. After editing it, run
`make agents-install-repo` to regenerate the repo-local harness skill files, and
`make agents-check-repo` to verify them.
