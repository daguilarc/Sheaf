# Package xagent Codex Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex-installable xagent plugin/package that runs from any repository and fix the Codex xagent skill's stale Claude model guidance.

**Architecture:** Keep `projects/xagent` as the TypeScript source of truth. Add a repo-owned Codex plugin at `plugins/xagent/` with a launcher script and staged runtime assets copied from a fresh xagent build; the launcher preserves the caller's working directory for child harnesses while packaged logs default to `/Users/joyo/Sheaf/data/xagent`.

**Tech Stack:** Node >=20, TypeScript, Bash launcher, Python validation script, Codex plugin manifest, OpenSpec, existing agents installer.

---

## File Structure

- Create `plugins/xagent/.codex-plugin/plugin.json`: Codex plugin manifest.
- Create `plugins/xagent/scripts/xagent`: stable launcher used by Codex agents; defaults `XAGENT_LOG_ROOT` to `/Users/joyo/Sheaf/data/xagent`.
- Create `plugins/xagent/skills/xagent-subagents/SKILL.md`: plugin-distributed Codex skill.
- Create `plugins/xagent/assets/xagent/`: staged runtime copied from `projects/xagent/package.json` and `projects/xagent/dist/src/`.
- Create `plugins/xagent/scripts/package_xagent.py`: deterministic packaging and validation helper.
- Modify `projects/xagent/src/logs.ts`, `projects/xagent/src/runtime.ts`, and `projects/xagent/src/cli.ts`: split active repository context from configured log root and emit `log_root_unavailable`.
- Modify `Makefile`: add `xagent-plugin-build` and `xagent-plugin-test` shortcuts.
- Modify `projects/agents/global/skills/xagent-subagents/SKILL.md`: managed global skill mirrors portable launcher guidance.
- Modify generated `.codex/skills/xagent-subagents/SKILL.md`: regenerated through `make agents-install-repo`.
- Modify `openspec/changes/package-xagent-codex-plugin/tasks.md`: mark tasks complete only after implementation, review, and verification.

### Task 1: Plugin Scaffold And Runtime Packaging

**Files:**
- Create: `plugins/xagent/.codex-plugin/plugin.json`
- Create: `plugins/xagent/scripts/package_xagent.py`
- Create: `plugins/xagent/scripts/xagent`
- Create: `plugins/xagent/assets/xagent/package.json`
- Create: `plugins/xagent/assets/xagent/dist/src/*.js`
- Modify: `Makefile`

- [ ] **Step 1: Create plugin scaffold files**

Create `plugins/xagent/.codex-plugin/plugin.json` with:

```json
{
  "name": "xagent",
  "version": "0.1.0",
  "description": "Run xagent cross-harness subagents from any Codex workspace.",
  "author": {
    "name": "Sheaf"
  },
  "license": "MIT",
  "keywords": ["xagent", "codex", "subagents", "review"],
  "skills": "./skills/",
  "interface": {
    "displayName": "xagent",
    "shortDescription": "Cross-harness subagents for Codex.",
    "longDescription": "Provides a packaged xagent launcher and Codex skill so agents can run review and worker subagents from any active repository.",
    "developerName": "Sheaf",
    "category": "Productivity",
    "capabilities": ["Write", "Review"],
    "defaultPrompt": [
      "Run an xagent review of this branch.",
      "Use xagent to get a Claude code review.",
      "Launch a cross-harness worker with xagent."
    ]
  }
}
```

- [ ] **Step 2: Add the launcher script**

Create `plugins/xagent/scripts/xagent`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
ENTRYPOINT="${PLUGIN_DIR}/assets/xagent/dist/src/main.js"
MAIN_SHEAF_LOG_ROOT="/Users/joyo/Sheaf/data/xagent"

if ! command -v node >/dev/null 2>&1; then
  echo "xagent plugin requires Node.js >=20, but node is not on PATH." >&2
  exit 127
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "xagent plugin requires Node.js >=20, found $(node --version)." >&2
  exit 1
fi

if [ ! -f "${ENTRYPOINT}" ]; then
  echo "xagent packaged runtime is missing: ${ENTRYPOINT}" >&2
  echo "Run make xagent-plugin-build from the Sheaf repository to rebuild plugin assets." >&2
  exit 1
fi

export XAGENT_LOG_ROOT="${XAGENT_LOG_ROOT:-${SHEAF_XAGENT_LOG_ROOT:-${MAIN_SHEAF_LOG_ROOT}}}"

exec node "${ENTRYPOINT}" "$@"
```

- [ ] **Step 3: Add the package helper**

Create `plugins/xagent/scripts/package_xagent.py` that:

```python
#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PLUGIN_ROOT.parents[1]
XAGENT_ROOT = REPO_ROOT / "projects" / "xagent"
ASSET_ROOT = PLUGIN_ROOT / "assets" / "xagent"


def run(args: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(args, cwd=cwd, env=merged_env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)


def stage_runtime() -> None:
    run(["npm", "run", "build"], cwd=XAGENT_ROOT)
    if ASSET_ROOT.exists():
        shutil.rmtree(ASSET_ROOT)
    (ASSET_ROOT / "dist").mkdir(parents=True)
    shutil.copy2(XAGENT_ROOT / "package.json", ASSET_ROOT / "package.json")
    shutil.copytree(XAGENT_ROOT / "dist" / "src", ASSET_ROOT / "dist" / "src")


def validate_launcher() -> None:
    launcher = PLUGIN_ROOT / "scripts" / "xagent"
    help_result = run([str(launcher), "--help"], cwd=Path(tempfile.mkdtemp(prefix="xagent-plugin-help-")))
    if "xagent run" not in help_result.stdout:
        raise RuntimeError("packaged launcher help output did not include xagent usage")
    with tempfile.TemporaryDirectory(prefix="xagent-plugin-repo-") as tempdir:
        repo = Path(tempdir)
        log_root = repo.parent / f"{repo.name}-central-log"
        run(
            [str(launcher), "run", "--harness", "codex", "--subagent", "hello"],
            cwd=repo,
            env={"XAGENT_TEST_ADAPTER": "fake", "XAGENT_LOG_ROOT": str(log_root)},
        )
        if not log_root.is_dir():
            raise RuntimeError("packaged launcher did not write logs under the configured log root")
        if (repo / "data" / "xagent").exists():
            raise RuntimeError("packaged launcher wrote logs under the active repository")


def main() -> int:
    stage_runtime()
    validate_launcher()
    print(f"staged xagent runtime in {ASSET_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Wire Makefile shortcuts**

Add phony targets to root `Makefile`:

```make
.PHONY: xagent-plugin-build xagent-plugin-test

xagent-plugin-build:
	python3 plugins/xagent/scripts/package_xagent.py

xagent-plugin-test:
	python3 plugins/xagent/scripts/package_xagent.py
	python3 /Users/joyo/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/xagent
```

- [ ] **Step 5: Run packaging**

Run: `make xagent-plugin-build`

Expected: exits zero, stages `plugins/xagent/assets/xagent/dist/src/main.js`, and validates help plus fake-harness central logging from a temporary non-Sheaf directory.

### Task 2: Skill Guidance And Managed Outputs

**Files:**
- Create: `plugins/xagent/skills/xagent-subagents/SKILL.md`
- Modify: `projects/agents/global/skills/xagent-subagents/SKILL.md`
- Modify: `.codex/skills/xagent-subagents/SKILL.md`

- [ ] **Step 1: Write plugin skill**

Create `plugins/xagent/skills/xagent-subagents/SKILL.md` with guidance that:

```markdown
---
name: xagent-subagents
description: Use packaged xagent from Codex to launch cross-provider review and worker subagents from any active repository.
---

# xagent Subagents

Use the packaged launcher supplied by the xagent Codex plugin:

```shell
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<review prompt>"
```

When the plugin is installed outside the Sheaf repository, resolve the launcher from the installed plugin package and run it from the active worktree root. The xagent executable code comes from the plugin assets; the child harness working directory belongs to the active repository; packaged logs default to `/Users/joyo/Sheaf/data/xagent` unless `XAGENT_LOG_ROOT` is set.

For strongest Claude Code review, use `--model opus`. Do not use `claude-opus-4.8`; local Claude Code rejects that stale dotted alias. If a different Claude Code alias is needed, verify it with local Claude Code help before retrying, and do not silently downgrade after a model rejection.
```

Then include the existing review/worker/failure-handling sections adjusted to use the packaged launcher phrase instead of bare `xagent`.

- [ ] **Step 2: Update managed source skill**

Modify `projects/agents/global/skills/xagent-subagents/SKILL.md` to match the plugin skill's behavior: packaged launcher first, active worktree root semantics, `--model opus`, no `claude-opus-4.8`, local alias verification, and no ad hoc rebuilds from guessed paths.

- [ ] **Step 3: Regenerate repo-local skill output**

Run: `make agents-install-repo`

Expected: `.codex/skills/xagent-subagents/SKILL.md` is regenerated from the managed source; no Claude/Cursor/Pi copies are created for this Codex-only skill.

- [ ] **Step 4: Check generated skill output**

Run: `make agents-check-repo`

Expected: exits zero.

### Task 3: Validation Coverage And Plugin Decision

**Files:**
- Modify: `plugins/xagent/scripts/package_xagent.py`
- Modify: `plugins/xagent/scripts/xagent`
- Modify: `openspec/changes/package-xagent-codex-plugin/design.md` if the MCP decision needs a short note

- [ ] **Step 1: Verify negative runtime asset behavior**

Add a `--check-missing-runtime` mode or direct test helper in `package_xagent.py` that temporarily moves `assets/xagent/dist/src/main.js`, runs `scripts/xagent --help`, and asserts stderr includes `xagent packaged runtime is missing`.

- [ ] **Step 1b: Verify unavailable log root behavior**

Add or keep a runtime test that points `logRoot` inside a regular file path, invokes `runSession`, and asserts stdout contains an `error` event with `code: "log_root_unavailable"` followed by `session.ended`.

- [ ] **Step 2: Decide MCP scope**

Record the implementation decision in a short comment or validation note: this change does not expose MCP tools. The launcher is the required portable interface; MCP can be added later by delegating to the same launcher.

- [ ] **Step 3: Run plugin validation**

Run:

```bash
python3 /Users/joyo/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/xagent
```

Expected: exits zero with no placeholders or manifest schema errors.

### Task 4: OpenSpec Progress And Final Verification

**Files:**
- Modify: `openspec/changes/package-xagent-codex-plugin/tasks.md`

- [ ] **Step 1: Run xagent tests**

Run: `make -C projects/xagent test`

Expected: xagent build and all Node tests pass.

- [ ] **Step 2: Run plugin package validation**

Run: `make xagent-plugin-test`

Expected: plugin packaging, launcher smoke tests, missing-runtime validation, and plugin manifest validation pass.

- [ ] **Step 3: Verify OpenSpec**

Run: `openspec validate package-xagent-codex-plugin`

Expected: `Change 'package-xagent-codex-plugin' is valid`.

- [ ] **Step 4: Manual cross-repo smoke**

Run from a temp directory with no `projects/xagent` and a temp central log root:

```bash
tmpdir="$(mktemp -d)"
logroot="$(mktemp -d)"
(cd "$tmpdir" && XAGENT_LOG_ROOT="$logroot" XAGENT_TEST_ADAPTER=fake /Users/joyo/.codex/worktrees/a63e/Sheaf/plugins/xagent/scripts/xagent run --harness codex --subagent "portable smoke")
test -d "$logroot"
test ! -e "$tmpdir/data/xagent"
```

Expected: run exits zero, the central log root contains run logs, and the active temp repository has no `data/xagent/`.

- [ ] **Step 5: Mark OpenSpec tasks complete**

Only after Steps 1-4 pass and review is accepted, update all checkboxes in `openspec/changes/package-xagent-codex-plugin/tasks.md` from `- [ ]` to `- [x]`.

## Review Protocol

After each task, run a spec-compliance review first and a code-quality review second. Use local xagent for at least the final review:

```bash
printf '%s\n' '{"type":"control.exit"}' | node projects/xagent/dist/src/main.js run --harness claude_code --model opus --subagent "<review prompt>"
```

Fix Critical and Important findings before marking the task complete.
