## Context

`projects/xagent` is a TypeScript CLI with a `bin` entry that runs from `dist/src/main.js` after `npm run build`. The current `xagent-subagents` skill is Codex-only, but it assumes `xagent` is already available on `PATH` and gives command examples that depend on a prebuilt runtime in the active workspace. Fresh Codex agents and agents working in other repositories do not have that setup.

The same skill currently recommends Claude model names such as `claude-opus-4.8`; local Claude Code rejected that dotted alias and accepted aliases such as `opus` or hyphenated full names. The package work should fix both the executable discovery problem and the stale model guidance.

## Goals / Non-Goals

**Goals:**
- Make xagent usable by Codex from any active repository root.
- Ship a stable Codex-facing launcher or tool with the xagent runtime, so agents do not need to build `projects/xagent` before use.
- Keep child harnesses rooted in the active repository while keeping packaged xagent logs in a central main-Sheaf log root.
- Let sandboxed agents invoke xagent even when they lack permissions for real runs, with explicit structured errors for unavailable log roots or harnesses.
- Update the Codex xagent skill to use the packaged invocation path and valid Claude Code model aliases.
- Add validation that proves the package works outside the Sheaf checkout.

**Non-Goals:**
- Do not bundle or authenticate Claude Code, Cursor Agent, Pi, or Codex itself; those harnesses remain external prerequisites.
- Do not replace xagent's existing CLI protocol or log format.
- Do not silently fall back to weaker models when a requested model is rejected.
- Do not make non-Codex harnesses load the Codex-only skill.

## Decisions

1. Package xagent as a Codex plugin distribution.

   A plugin is the right installable boundary because it can carry the skill, launcher scripts, and runtime assets together. A bare skill with bundled scripts is possible in Codex, but the current `projects/agents` installer only renders `SKILL.md`; relying on skill-local scripts would either fail today or require changing the installer before the xagent distribution exists. A plugin also fits the cross-repository requirement because it is installed into Codex rather than discovered from the active repo.

   Alternative considered: teach the skill to build `projects/xagent` from the Sheaf repository. That keeps setup fragile, requires agents to know where Sheaf is, and fails when the active task is in another repository.

2. Keep `projects/xagent` as the runtime source of truth and add an explicit package build step.

   The package build should run `npm ci` or the existing install step, run `npm run build`, then stage the compiled `dist/`, `package.json`, and launcher into the plugin assets. Because xagent currently has no runtime npm dependencies beyond Node after compilation, the staged runtime can be small and deterministic. If future runtime dependencies are added, the package build should either include production dependencies or bundle the CLI into a single runnable artifact.

   Alternative considered: check `dist/` into the repository. The repository already ignores `projects/xagent/dist/`, and committing generated build output would add churn without solving plugin packaging metadata.

3. Use a launcher script as the primary compatibility layer, with an MCP tool as an optional ergonomic layer.

   The launcher should live inside the plugin and execute `node <plugin-assets>/xagent/dist/src/main.js "$@"` after validating Node >=20 and the packaged asset path. It must preserve the caller's current working directory for child harnesses, while setting `XAGENT_LOG_ROOT` to `SHEAF_XAGENT_LOG_ROOT` when present or `/Users/joyo/Sheaf/data/xagent` by default. If the plugin also exposes MCP tools such as `xagent_run`, `xagent_list`, and `xagent_logs`, those tools should delegate to the same launcher so behavior remains identical.

   Alternative considered: make the MCP tool the only interface. Shell examples remain useful in skills, logs, and debugging, and a script gives a simple fallback if the MCP surface is unavailable.

4. Update the installed skill source, not generated files by hand.

   The source at `projects/agents/global/skills/xagent-subagents/SKILL.md` should be revised to describe portable packaged invocation and to recommend `--model opus` for strongest Claude Code review. After source edits, run the agents installer so `.codex/skills/xagent-subagents/SKILL.md`, `$HOME/.agents/skills/...`, and `$CODEX_HOME/skills/...` are regenerated as appropriate.

   Alternative considered: edit only `.codex/skills/xagent-subagents/SKILL.md`. That generated file would drift from the managed source and be overwritten by the installer.

5. Split active repository context from log persistence.

   xagent should treat the active `cwd`/`repoRoot` as the project context used for child harnesses and path sanitization. A separate `logRoot` should determine where run metadata and JSONL logs are written. The CLI should resolve `logRoot` from `XAGENT_LOG_ROOT`, falling back to repo-local `data/xagent` for direct source-tree use; the packaged launcher sets `XAGENT_LOG_ROOT` to the main Sheaf log root. If the log root cannot be created or written, `xagent run` should emit structured JSONL with `code: "log_root_unavailable"` and exit non-zero before starting a child harness.

6. Validate outside the Sheaf checkout.

   Tests should create a temporary directory that is not under the Sheaf repository, invoke the packaged launcher there with `--help` and with `XAGENT_TEST_ADAPTER=fake`, and assert logs land under a configured central log root rather than under the active temporary repository. This directly covers the user-visible failure mode: a fresh Codex workspace with no local xagent build and, potentially, limited write permissions.

## Risks / Trade-offs

- Packaged runtime can go stale relative to `projects/xagent` source -> Build and validation targets must regenerate the plugin assets from source and fail if the package is stale.
- Node may be missing or too old in a Codex environment -> The launcher should fail with a concise diagnostic naming Node >=20 as the missing prerequisite.
- Sandboxed agents may be able to execute the launcher but not write `/Users/joyo/Sheaf/data/xagent` -> xagent should emit `log_root_unavailable` and exit before starting harnesses; callers can still use `--help`, `list`, and retry with `XAGENT_LOG_ROOT` when appropriate.
- Plugin and agents-installer skill copies could diverge -> Prefer making the plugin's skill the primary distribution path; if the managed global skill remains, add tests/checks that its command examples and model aliases match the plugin skill.
- Claude Code model aliases may change again -> The skill should recommend the stable local alias `opus` and tell agents to verify unfamiliar aliases locally instead of encoding unverified versioned names.
- MCP tool availability could lag plugin installation -> The skill should document the launcher path as the required interface and mention MCP tools only when installed.

## Migration Plan

1. Add the xagent Codex plugin/package source and a build target that stages compiled xagent runtime assets.
2. Add launcher validation and fake-harness smoke tests that run from a temporary non-Sheaf repository.
3. Update `xagent-subagents` source guidance and regenerate managed Codex skill outputs.
4. Install or update the local Codex plugin during development using the repository's plugin workflow.
5. Remove or de-emphasize any documentation that tells Codex agents to call bare `xagent` without first resolving the packaged launcher/tool.
6. Document that packaged xagent defaults logs to `/Users/joyo/Sheaf/data/xagent` and that `XAGENT_LOG_ROOT` can override this for validation or intentionally isolated runs.
