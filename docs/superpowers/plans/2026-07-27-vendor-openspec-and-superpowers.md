# Vendor OpenSpec and Superpowers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor OpenSpec and Superpowers under `projects/agents/vendor/`, install the OpenSpec CLI and repo harness artifacts from that vendor tree, and install Superpowers as managed local plugins for Claude/Cursor/Pi/Codex — with no global npm OpenSpec or marketplace Superpowers dependency for Sheaf.

**Architecture:** Offline-capable vendor trees (`openspec/package/` including `node_modules`; `superpowers/tree/`). `install.py` owns OpenSpec CLI + repo harness file outputs (temp `openspec` generate, copy with managed markers; never touch root `AGENTS.md`/`CLAUDE.md`). Sibling `install_superpowers.py` owns per-harness managed plugins; Makefile invokes both for global/all scopes. Landing commit regenerates existing OpenSpec harness files with markers.

**Tech Stack:** Python 3 agents installer, Node ≥20.19 for vendored OpenSpec CLI, Make, git-tracked vendor trees, harness plugin registries.

## Global Constraints

- OpenSpec pin ≈1.4.1; tools `claude,cursor,pi,codex`; workflows `propose`, `apply-change`, `archive-change`, `explore`, `sync-specs`
- OpenSpec Node engine `>=20.19.0`
- Managed markers for OpenSpec files; package-level `.sheaf-managed` for Superpowers plugins (record revision+version)
- No `npm install -g`; no marketplace/`pi install git:…` as install path
- Preserve `superpowers:<id>` namespace (asd-19)
- Do not merge Superpowers into Sheaf `$CODEX_HOME/hooks.json`
- `install.py` stays unaware of Superpowers
- Member of this plan: work only under the active worktree; do not push unless asked

---

## File map

| Path | Responsibility |
| --- | --- |
| `projects/agents/vendor/openspec/VENDOR.toml` + `package/` | Offline OpenSpec pin + package tree |
| `projects/agents/vendor/superpowers/VENDOR.toml` + `tree/` | Superpowers pin + upstream tree |
| `projects/agents/scripts/vendor_sync.py` | Fetch/build vendor trees |
| `projects/agents/scripts/install.py` | OpenSpec CLI + harness outputs; existing skills |
| `projects/agents/scripts/install_superpowers.py` | Managed Superpowers plugins |
| `projects/agents/scripts/*_test.py` | Unit tests |
| `projects/agents/Makefile` | Wire sync + sibling install/check/clean |
| `projects/agents/README.md` | Vendor-first docs |
| Repo `.claude/.cursor/.pi/.codex` OpenSpec skills/commands | Regenerated managed outputs |

---

## Task 1: Vendor layout, sync script, and initial pins

**Files:**
- Create: `projects/agents/vendor/openspec/VENDOR.toml`, `projects/agents/vendor/superpowers/VENDOR.toml`
- Create: `projects/agents/scripts/vendor_sync.py`, `projects/agents/scripts/vendor_sync_test.py`
- Modify: `projects/agents/Makefile`, root `.gitignore` only if needed to **un-ignore** `projects/agents/vendor/**/node_modules`
- Create via sync: `projects/agents/vendor/openspec/package/**`, `projects/agents/vendor/superpowers/tree/**`

- [ ] **Step 1: Write failing tests for VENDOR.toml schema and sync refuse-to-clobber**

```python
# vendor_sync_test.py sketches
# - parse_vendor_toml requires url, revision, version, retrieved_at
# - sync without --force raises when vendor dir has local modifications
```

- [ ] **Step 2: Run tests — expect fail**
- [ ] **Step 3: Implement `vendor_sync.py`**
  - `openspec`: produce offline `package/` (npm pack or registry fetch + `npm install --omit=dev` into staging, then replace); write VENDOR.toml
  - `superpowers`: clone/fetch pinned revision into `tree/`; write VENDOR.toml
  - refuse dirty vendor tree without `--force`
- [ ] **Step 4: Ensure git tracks vendor `node_modules`** (negate ignore under `projects/agents/vendor/`)
- [ ] **Step 5: Run sync for OpenSpec ≈1.4.1 and current Superpowers pin; commit vendor trees + script + tests**
- [ ] **Step 6: Add `make agents-vendor-sync` (and projects/agents Makefile target); document in README briefly**

**Done when:** `vendor/openspec/package/bin/openspec.js` runs via `node` and prints version matching VENDOR.toml; Superpowers `tree/skills/` present; tests pass.

---

## Task 2: OpenSpec CLI managed install (`install.py`)

**Files:**
- Modify: `projects/agents/scripts/install.py`, `install_test.py`
- Docs: README PATH note

- [ ] **Step 1: Failing tests** for shim install, version==VENDOR.toml version, Node-skip warning path, clean removes managed prefix only
- [ ] **Step 2: Implement** copy/link `vendor/openspec/package` → `~/.local/share/sheaf/vendor/openspec/` + shim `~/.local/share/sheaf/bin/openspec`; no postinstall; no global npm fallback
- [ ] **Step 3: Node missing/too-old** → warn, skip CLI, continue other global outputs
- [ ] **Step 4: check/clean** for CLI; tests green; commit

**Done when:** global install on supported Node creates shim with matching version; Node-skip covered by test.

---

## Task 3: OpenSpec repo harness artifacts (`install.py`)

**Files:**
- Modify: `install.py`, `install_test.py`
- Regenerate: `.claude/skills/openspec-*`, `.cursor/skills/openspec-*`, `.pi/skills/openspec-*`, `.codex/skills/openspec-*`, `.claude/commands/opsx/*`, `.cursor/commands/opsx-*.md`, `.pi/prompts/opsx-*.md`

- [x] **Step 1: Failing tests** for temp generation via vendored entry point, managed markers, five workflows × four harnesses, opsx for claude/cursor/pi, codex skills-only, AGENTS.md/CLAUDE.md untouched, Node hard-fail for repo install/check
- [x] **Step 2: Implement** generate in tempfile with pinned tools/workflows from VENDOR.toml; copy only skill/command paths through managed writers
- [x] **Step 3: Assert** root AGENTS.md/CLAUDE.md unchanged and without OPENSPEC blocks
- [x] **Step 4: Regenerate** all existing tracked OpenSpec harness outputs with markers in this commit
- [x] **Step 5: check** regenerates expected content (byte-reproducible); clean removes managed only
- [x] **Step 6: Tests green; commit**

**Done when:** `install.py install --scope repo` succeeds without `--force` on this tree; `check --scope repo` passes; AGENTS.md unchanged.

---

## Task 4: Superpowers managed plugins (`install_superpowers.py`)

**Files:**
- Create: `projects/agents/scripts/install_superpowers.py`, `install_superpowers_test.py`
- Modify: `projects/agents/Makefile` (and root Makefile if needed)

- [x] **Step 1: Timebox discovery** for Cursor/Pi exact registry paths if design placeholders need tightening; amend design only if a harness cannot support managed plugins
- [x] **Step 2: Failing tests** for Claude package destination + `installed_plugins.json` key merge; Codex path parallel to xagent; marker records revision/version; executable bits preserved; unrelated registry keys untouched; unmanaged same-key conflict; stale-pin check
- [x] **Step 3: Implement** install/check/clean for four harnesses from `vendor/superpowers/tree/`
- [x] **Step 4: Do not touch** Sheaf `$CODEX_HOME/hooks.json`
- [x] **Step 5: Wire Makefile** so `install-global`/`check-global`/`clean-global`/`all` invoke sibling script after/beside `install.py`
- [x] **Step 6: Tests green; commit**

**Done when:** sibling script installs marked Superpowers packages; Make global targets invoke it; `install.py --scope global` alone does not.

---

## Task 5: Docs, smoke, validate

- [x] **Step 1: Update** `projects/agents/README.md` (vendor-first, PATH, marketplace disable guidance, Node for repo check/tests, asd-23 exception for Superpowers sibling script)
- [x] **Step 2: Smoke** managed `openspec --version`; repo skills/commands; Superpowers `superpowers:*` (or harness-equivalent) on each harness where automatable
- [x] **Step 3: Run** `python3 -m unittest discover -s projects/agents/scripts -p '*_test.py'` and `openspec validate vendor-openspec-and-superpowers --strict`
- [x] **Step 4: Mark** corresponding OpenSpec `tasks.md` checkboxes complete after each Superpowers task’s reviews pass
- [x] **Step 5: Commit** docs/smoke fixes

---

## Execution notes (controller)

- No native subagents.
- Implementers: `xagent supervise --harness cursor --model grok-4.5` (thinking high).
- Reviewers: `xagent supervise --harness claude_code --model opus` (thinking high).
- Keep implementer/reviewer sessions open per task for fix/re-review via `xagent message`.
- If Claude Code runs out of tokens, wait and retry; do not switch reviewers.
- Dispatch full briefs via `dispatch-prompt`; never summarize requirements into the prompt body.
- Real service: `127.0.0.1:9005` quiet client.
