## Why

xagent run logs were accidentally created and tracked under `projects/xagent/data/xagent/`, even though runtime data belongs in the repo-level `data/xagent/` tree. The implementation and repository hygiene need to make the top-level location explicit so generated logs do not pollute project source directories or Git history again.

## What Changes

- Make xagent resolve its default local run-log root to the Sheaf repository's top-level `data/xagent/`, not the current package directory when invoked from `projects/xagent`.
- Keep generated xagent run records out of Git by relying on the existing top-level `data/**` ignore policy and removing any tracked `projects/xagent/data/xagent/` run artifacts.
- Add regression coverage for invoking xagent from inside `projects/xagent` while still writing logs to the top-level runtime data directory.
- Preserve `XAGENT_LOG_ROOT` as the explicit override for tests and packaged launcher use.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `xagent-cli`: clarify and enforce that default non-overridden xagent run logs are stored under the repository-level `data/xagent/`, including when the CLI process is launched from the `projects/xagent` package directory.

## Impact

- Affected code: `projects/xagent/src/cli.ts`, `projects/xagent/src/logs.ts`, and xagent tests.
- Affected repository hygiene: `.gitignore` and removal of tracked generated files under `projects/xagent/data/xagent/`.
- No external API change: command names, JSONL protocol, and `XAGENT_LOG_ROOT` override behavior remain unchanged.
