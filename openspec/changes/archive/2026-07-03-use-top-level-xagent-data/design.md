## Context

xagent is a `projects/xagent` TypeScript CLI, but its run logs are runtime data for the Sheaf checkout rather than source artifacts for the package. The current contract already names repo-local `data/xagent/`, and the original implementation plan expected `<repoRoot>/data/xagent/<run_id>/`; however, invoking the CLI with `cwd` set to `projects/xagent` can make `projects/xagent/data/xagent/` look like the repository data root.

The repository already ignores top-level `data/**` while keeping `data/.gitkeep`, so the simplest fix is to make xagent consistently discover or receive the real Sheaf repository root before applying the existing `data/xagent` default.

## Goals / Non-Goals

**Goals:**

- Default xagent run logs to `<sheaf-repo-root>/data/xagent/` for local source-tree invocations.
- Preserve `XAGENT_LOG_ROOT` as the highest-priority explicit log root override.
- Remove tracked generated run artifacts from `projects/xagent/data/xagent/` and prevent new nested package-local logs from becoming the default.
- Add regression tests that cover launching from `projects/xagent` and reading logs through offline commands.

**Non-Goals:**

- Changing xagent's JSONL protocol, run-id format, or log file names.
- Moving existing top-level logs or introducing an automated migration for local, ignored runtime data.
- Changing packaged launcher semantics that intentionally use the configured central log root.

## Decisions

1. Resolve the default log root from the Sheaf repository root, not raw process `cwd`.

   `XAGENT_LOG_ROOT` remains authoritative when set. Otherwise, the CLI should use a repository-root resolver before calling `getDefaultLogRoot`, so `cwd=/path/to/Sheaf/projects/xagent` still yields `/path/to/Sheaf/data/xagent`.

   Alternative considered: add `projects/xagent/data/xagent/` to `.gitignore` and leave runtime behavior alone. That avoids tracking mistakes but keeps the data in the wrong place and contradicts the existing xagent CLI spec.

2. Keep runtime data under the existing top-level ignore policy.

   Top-level `data/**` is already ignored, so generated xagent logs should not need a new special-case ignore once they are written under `data/xagent/`. The implementation should still remove any tracked `projects/xagent/data/xagent/` files because those are generated artifacts.

   Alternative considered: add a narrow `projects/xagent/data/xagent/` ignore rule. That is useful as a belt-and-suspenders cleanup only if implementation risk remains, but it should not be the primary fix because the package-local directory should not be the default output path.

3. Test the cwd boundary directly.

   Regression coverage should run xagent with a fixture repository root and `cwd` set to the nested package directory, then assert that created logs and offline reads use the fixture root's `data/xagent/` tree and do not create `projects/xagent/data/xagent/`.

   Alternative considered: only unit-test `getDefaultLogRoot`. That is too narrow because the bug appears at the CLI boundary where `cwd`, overrides, run creation, list, and logs interact.

## Risks / Trade-offs

- Repository-root discovery can fail in copied or packaged contexts -> keep `XAGENT_LOG_ROOT` authoritative and preserve packaged launcher configuration paths.
- Tests may accidentally depend on this actual Sheaf checkout layout -> use temporary fixture directories that include a nested `projects/xagent` path and a repo marker.
- Removing tracked generated logs changes Git history going forward but not local ignored files -> document that local runtime logs are disposable and can be regenerated.

## Migration Plan

1. Update xagent log-root resolution and tests.
2. Remove tracked `projects/xagent/data/xagent/` generated run files from the repository.
3. Verify generated run logs land under top-level `data/xagent/` and are ignored by Git.
4. Roll back by reverting the implementation commit; no persistent data schema migration is required.

## Open Questions

- None.
