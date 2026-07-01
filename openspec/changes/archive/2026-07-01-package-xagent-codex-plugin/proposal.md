## Why

Codex agents currently learn about `xagent` through a skill that assumes the `xagent` binary is already on `PATH` and built in the active repository. That breaks in fresh Codex workspaces and in non-Sheaf repositories, and the skill also documents stale Claude Code model names that cause avoidable launch failures.

## What Changes

- Package xagent as a Codex-installable distribution that is usable from any repository, not only from the Sheaf checkout.
- Provide a stable Codex-facing launcher/tool path so agents do not need `xagent` on `PATH`, a local `projects/xagent/dist/` build, or knowledge of xagent's TypeScript build steps.
- Keep the `xagent-subagents` skill Codex-only, but revise it to route through the packaged launcher/tool and document portable usage from arbitrary worktree roots.
- Fix Claude Code model guidance so the recommended Opus invocation uses locally accepted aliases such as `opus`, and avoid stale dotted names such as `claude-opus-4.8`.
- Preserve current xagent CLI behavior, harness selection, and failure semantics while centralizing packaged xagent logs under the main Sheaf repository and making missing plugin assets, log permissions, Node runtime problems, and unavailable harnesses fail loudly.

## Capabilities

### New Capabilities

### Modified Capabilities
- `xagent-cli`: xagent must be distributable through a Codex plugin or equivalent packaged launcher, run correctly from repositories that do not contain `projects/xagent`, and default packaged logs to the main Sheaf repository.
- `agents-skill-distribution`: the global Codex-only xagent skill must point agents at the packaged launcher/tool and use valid Claude Code model aliases.

## Impact

- Affected code: `projects/xagent`, `projects/agents/global/skills/xagent-subagents`, and likely a new Codex plugin/package location under this repository.
- Affected generated outputs: repo-local and user-global Codex skill installs produced by `projects/agents/scripts/install.py`.
- Affected runtime behavior: Codex agents can launch xagent from any repository root while packaged xagent defaults run logs to `/Users/joyo/Sheaf/data/xagent`; agents without log or harness permissions receive explicit failures instead of shell crashes.
- Dependencies: Node >=20 remains required for the xagent runtime; Claude Code, Cursor, Codex, or Pi harness authentication remains external to xagent.
