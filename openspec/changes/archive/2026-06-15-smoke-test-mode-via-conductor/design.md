## Context

Sheaf services resolve their files relative to a discovered repository root:
Conductor via `createRepoPaths`/`findRepoRoot` ([paths.ts](../../../projects/conductor/src/paths.ts)),
Dictator via `SheafRootDiscovery.requireRepoRoot()`
([DictatorServiceMain.swift](../../../projects/dictator/src/Sources/DictatorService/DictatorServiceMain.swift)),
and Sheaf Chat via `FindRepositoryRoot`
([repo_paths.ts](../../../projects/sheaf-chat/src/server/repo_paths.ts)). When a
service runs from a feature worktree, that root is the worktree, and the
git-ignored assets it needs — `config/api_keys.json`, `.secrets.json`, and the
whisper/STT models under `models/` — are absent (git worktrees share `.git` but
not ignored working-tree files). Today agents bridge this gap by hand-copying
those assets out of the main checkout and starting servers on the production
ports, after taking the real production services down.

Conductor already manages service lifecycle: it spawns the registry `command`
as a detached process with the repo root as the working directory
([lifecycle.ts](../../../projects/conductor/src/lifecycle.ts),
[process_runner.ts](../../../projects/conductor/src/process_runner.ts)) and
exposes `POST /api/services/<name>/{start,stop,restart}`
([server.ts](../../../projects/conductor/src/server.ts)). The process runner
currently passes **no** custom environment to children — they inherit
Conductor's environment as-is.

## Goals / Non-Goals

**Goals:**
- A single environment flag, `SHEAF_SMOKE_TEST_MODE`, that marks a process as
  running for testing. It is deliberately general so future test-only behavior
  reuses the same switch.
- In smoke mode, services read git-ignored **assets** from a main-repo asset
  root (`SHEAF_SMOKE_ASSET_ROOT`) while still running the worktree's code and
  tracked config.
- Drive the whole thing through Conductor: an optional `smoke_test` flag on the
  start/restart endpoints launches services in smoke mode with the asset root
  filled in automatically.
- A `smoke-test` agent skill with a ready-to-run script so launching services
  for human testing is one step.

**Non-Goals:**
- Running multiple worktrees' smoke instances **in parallel**. Conductor
  restart rebinds each service's registered production port, so a smoke launch
  replaces the running production instance on that port — exactly the behavior
  used today, now automated. Per-worktree port offsets are a possible later
  change, out of scope here.
- Redirecting *tracked* config (e.g. `config/services.json`,
  `config/dictator.json`) to the main repo. Only git-ignored assets are
  redirected; tracked files come from the worktree so the worktree is what we
  test.
- Changing the regular `make test` lane. Smoke mode only affects how a running
  service locates git-ignored assets at startup.
- Smoke-testing Conductor itself through its own API. Conductor has no external
  asset dependencies; to exercise the worktree's Conductor, run it directly
  (`make conductor-run`). The skill documents this.

## Decisions

### 1. Two environment variables: a mode flag and an asset root

`SHEAF_SMOKE_TEST_MODE` (truthy, e.g. `1`) turns smoke mode on.
`SHEAF_SMOKE_ASSET_ROOT` is an absolute path to the repository whose git-ignored
assets should be used.

Rationale: separating "are we in smoke mode" from "where are the assets" keeps
the mode flag a clean, reusable boolean for future test behavior, while the
asset root is an explicit, inspectable path rather than implicit magic.
Alternative considered — a single variable holding the path (presence ⇒ mode):
rejected because we want the mode flag to outlive this one feature and gate
behavior that has nothing to do with assets.

**Asset set redirected in smoke mode:** `config/api_keys.json`, `.secrets.json`,
and the whisper/STT model path(s) under `models/`. These are exactly the
git-ignored files (see [.gitignore](../../../.gitignore)). Each service redirects
only the assets it actually reads.

**Fallback:** IF `SHEAF_SMOKE_TEST_MODE` is set but `SHEAF_SMOKE_ASSET_ROOT` is
unset, empty, or not an existing directory, services log a warning and fall back
to normal repo-root asset resolution. Smoke mode never hard-fails startup just
because the asset root is missing.

### 2. Conductor owns asset-root discovery

Conductor computes the main working tree's root and passes it as
`SHEAF_SMOKE_ASSET_ROOT`. Resolution order:
1. An explicit `SHEAF_SMOKE_ASSET_ROOT` already in Conductor's own environment
   (operator override) wins.
2. Otherwise discover the main working tree from git. `git rev-parse
   --git-common-dir` resolves to the shared `.git` directory; its parent is the
   main working tree. (`git worktree list --porcelain` first entry is an
   equivalent source.)
3. If Conductor is running from the main checkout (not a worktree), the asset
   root is its own repo root.

Rationale: Conductor is the orchestrator and already knows the repo root; the
agent/skill should not have to compute or pass a path. Alternative — require the
caller to pass `asset_root` in the request body: rejected as avoidable friction,
though we keep the operator-override env var as an escape hatch.

### 3. Optional `smoke_test` flag on existing lifecycle endpoints (additive)

`POST /api/services/<name>/start` and `POST /api/services/<name>/restart` accept
an optional JSON body `{ "smoke_test": true }`. Absent or `false` ⇒ today's
behavior exactly (backward compatible; the requirements are added, not
rewritten). When `true`, Conductor injects `SHEAF_SMOKE_TEST_MODE=1` and the
discovered `SHEAF_SMOKE_ASSET_ROOT` into the spawned child's environment.

Restart is the primary entry point: it stops the running production instance and
starts the worktree's service in smoke mode on the same registered port —
automating the "take prod down, run the worktree on prod ports" ritual.

### 3a. Dictator env-var guard exception

Dictator's `MigrationExclusionTests` forbids reading
`ProcessInfo.processInfo.environment` anywhere in active source — an
architectural rule that Dictator configuration comes from files, not env vars.
The smoke-test contract is inherently an env-var signal (set by Conductor, read
by every service), so Dictator cannot honor it without reading the environment.

Resolution: localize the single env read into
`DictatorCore/SmokeTestMode.swift`
(`resolveAssetRootFromProcessEnvironment(repoRoot:)`) and add a narrow per-file
exception in `MigrationExclusionTests` for exactly that file, using the same
whitelist mechanism the guard already applies to other patterns. The "no
env-based config" rule stays in force everywhere except the one sanctioned
smoke-test bridge. Alternatives considered — passing the asset root to Dictator
via a CLI flag (diverges from the uniform env contract and adds Conductor
special-casing) and dropping Dictator from smoke mode (contradicts the goal) —
were rejected.

### 4. Thread a custom env through the process runner

`spawnCommand` / `ProcessRunner.spawn` gain an optional `env` map merged over
`process.env` (child still inherits Conductor's environment, plus the smoke
vars). `LifecycleManager.StartService`/`RestartService` accept a
`smokeTest: boolean` option and build that env from the discovered asset root.

Rationale: minimal, localized extension of the existing spawn path; non-smoke
spawns pass no env and behave identically.

### 5. Smoke-test skill with a ready-to-run script

A new shared skill `projects/agents/global/skills/smoke-test/` (`skill.yaml`
with `id: smoke-test`, targets claude/cursor/pi/codex, plus `SKILL.md`)
documents the flow and ships a copy-paste `curl`/bash sequence: ensure Conductor
is running, then `POST /api/services/<name>/restart` with `{"smoke_test": true}`
for each asset-dependent service (dictator, sheaf-chat, quest-runner), then poll
`/api/services/<name>/health`. It is distributed by the existing installer
(see `agents-skill-distribution`); the skill body reminds the agent to run
`make agents-install` after adding/editing it.

## Risks / Trade-offs

- **Smoke launch takes production's port / replaces the running prod service** →
  Accepted and documented; it mirrors current practice. Parallel-worktree smoke
  is an explicit Non-Goal. The skill states that a smoke restart displaces the
  running production instance on that port.
- **Reading real API keys / models from main while running worktree code** →
  This is the intended capability, but it means worktree code runs with live
  credentials. Mitigation: smoke mode is opt-in per request; the skill flags
  that it uses real keys and is for human-observed testing, not CI.
- **Asset-root discovery edge cases** (detached `.git`, unusual worktree
  layouts) → Mitigated by the operator-override env var and the
  warn-and-fallback behavior; discovery failure degrades to normal resolution
  rather than crashing.
- **Partial asset redirection drift** (a service later reads a new git-ignored
  asset without honoring the flag) → Mitigation: the env contract is defined
  once in `conductor-smoke-test`; per-service specs enumerate which assets they
  redirect, so the gap is visible in coverage docs.

## Migration Plan

Additive and backward compatible. No data migration. Rollout order matches
tasks: (1) Conductor env contract + API flag + discovery, (2) Dictator asset
redirect, (3) Sheaf Chat asset redirect, (4) skill + docs. Rollback is reverting
the change; non-smoke behavior is untouched throughout.

## Resolved Questions

- **Which services honor the flag?** Every service registered in
  `config/services.json` except Conductor — i.e. Dictator, Sheaf Chat, and
  quest-runner. Conductor is excluded because it has no external/git-ignored
  asset dependencies; it only defines and injects the contract. realtime-agent
  is not a registered service (no `config/services.json` entry), so it is out of
  scope. quest-runner's concrete git-ignored asset set is thinner than the
  others, so its spec redirects "any git-ignored assets it reads" rather than
  enumerating specific files.
- **Truthy parsing for `SHEAF_SMOKE_TEST_MODE`.** Decided: smoke-test mode is
  active when the variable is set to any non-empty value other than `0` or
  `false` (case-insensitive); unset, empty, `0`, or `false` is inactive.
