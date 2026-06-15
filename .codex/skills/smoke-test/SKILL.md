---
name: smoke-test
description: Launch the Sheaf services for human smoke testing through Conductor, with assets sourced from the main repo.
metadata:
  managedBy: sheaf-agents-installer
  source: projects/agents/global/skills/smoke-test
---

<!-- sheaf-agents-managed: DO NOT EDIT; source=projects/agents/global/skills/smoke-test -->

# Smoke Test

Use this skill to launch the Sheaf services for human smoke testing from a
feature worktree, without hand-copying API keys or models out of the main
checkout.

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

## Important: a smoke restart replaces the running production instance

Conductor restarts a service on its **registered production port** (9003 for
dictator, 9004 for sheaf-chat, 9002 for quest-runner). A smoke restart stops the
running production instance and starts the worktree's service in its place on
that same port. Only one instance can hold a port at a time, so do not run smoke
launches from multiple worktrees in parallel. These services use real API keys —
this is for human-observed testing, not CI.

Conductor itself (port 9001) has no external asset dependencies, so it is not
launched in smoke mode. To exercise a worktree's Conductor code, run it directly
with `make conductor-run`.

## Ready-to-run launch script

Conductor must already be running (`make conductor-run` from the worktree). Then
run this from the worktree root to launch the asset-dependent services in
smoke-test mode and wait for them to report healthy:

```bash
#!/usr/bin/env bash
set -euo pipefail

CONDUCTOR="http://127.0.0.1:9001"
SERVICES=(dictator sheaf-chat quest-runner)

# Conductor must be up first.
if ! curl -fsS "${CONDUCTOR}/health" >/dev/null; then
  echo "Conductor is not running on ${CONDUCTOR}. Start it with: make conductor-run" >&2
  exit 1
fi

# Restart each asset-dependent service in smoke-test mode.
for svc in "${SERVICES[@]}"; do
  echo "Restarting ${svc} in smoke-test mode..."
  curl -fsS -X POST "${CONDUCTOR}/api/services/${svc}/restart" \
    -H "Content-Type: application/json" \
    -d '{"smoke_test": true}' >/dev/null
done

# Poll each service's health until it comes up (up to ~30s each).
for svc in "${SERVICES[@]}"; do
  printf "Waiting for %s to be healthy" "${svc}"
  for _ in $(seq 1 30); do
    if curl -fsS "${CONDUCTOR}/api/services/${svc}/health" \
      | grep -q '"healthy":true'; then
      echo " ... healthy"
      break
    fi
    printf "."
    sleep 1
  done
done

echo "Smoke services launched. Open the service home pages to test by hand."
```

To launch a single service, restart just that one:

```bash
curl -fsS -X POST "http://127.0.0.1:9001/api/services/dictator/restart" \
  -H "Content-Type: application/json" \
  -d '{"smoke_test": true}'
```

## Maintaining this skill

This skill source lives at `projects/agents/global/skills/smoke-test/`. After
editing it, run `make agents-install` to regenerate the per-harness skill files,
and `make agents-check` to verify them.
