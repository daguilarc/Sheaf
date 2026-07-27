## Context

The Superpowers `subagent-driven-development` skill already externalizes two of
the three inputs a subagent needs. `scripts/task-brief PLAN N` extracts the
task text to a file and prints its path; `scripts/review-package PLAN BASE HEAD`
writes the commit list, stat summary, and `-U10` diff to a file and prints its
path. Both exist for the same reason: keep bulk content out of the controller's
context.

The third input — the role prompt itself — has no such script. It lives in
`implementer-prompt.md`, `task-reviewer-prompt.md`, `re-review-prompt.md`, and
`requesting-code-review/code-reviewer.md` as a documented template that the
controller is expected to fill in and emit as a message. That is the input that
decays, and it is the one carrying the review rubric.

Each template is a markdown wrapper around a single fenced pseudo-YAML block:

```
Subagent (general-purpose):
  description: "..."
  model: [MODEL — REQUIRED: ...]
  prompt: |
    <indented prompt body with [PLACEHOLDER] tokens>
```

followed by a `**Placeholders:**` list and a `**<Role> returns:**` note. Only
the indented prompt body is subagent-facing; everything else is documentation
for the controller.

Templates live under `~/.claude/plugins/cache/claude-plugins-official/superpowers/<version>/skills/`.
Several versions coexist on this machine (6.1.0, 6.1.1, 6.2.0). Codex and Cursor
both read from that same Claude-owned path, so one resolution strategy serves
every harness.

## Goals / Non-Goals

**Goals:**
- Make the full rubric reach the subagent without passing through the
  controller's output.
- Keep the invocation short. A long command line is itself something a
  context-pressured controller will shorten, so conventional inputs must be
  derived rather than typed.
- Fail loudly and early: a wrong or partial prompt is worse than no prompt,
  because its failure is silent and shows up as a clean review.
- Track upstream templates rather than forking them.

**Non-Goals:**
- Editing any prompt template, skill body, or workflow instruction. This change
  is additive; adoption at the call site is a separate decision.
- Model selection. `model:` lives in the template's dispatch scaffold, not its
  prompt body; the controller keeps choosing the model from `.assignments.yaml`.
- Dispatching the subagent. The utility renders a file and prints a path;
  spawning is the controller's job.
- Vendoring or caching template content in this repo.

## Decisions

### D1: Python 3, stdlib only, at `projects/agents/utils/dispatch-prompt`

The sibling scripts in Superpowers are bash, but their work is `awk`-shaped:
extract a heading block, run `git diff`. This utility does nested-fence-aware
extraction, dedenting, a data-driven placeholder manifest, and drift checking.
Python matches `projects/agents/scripts/install.py`, which is the established
convention for non-trivial tooling in this project, and keeps the manifest
readable as data.

*Alternative considered:* bash + awk, for symmetry with `task-brief`. Rejected —
the manifest and the required/optional distinction become string soup, and the
drift check (D5) is awkward to express.

The file is extensionless and executable with a `#!/usr/bin/env python3`
shebang, matching how `task-brief` and `review-package` are invoked.

### D2: Extract the prompt body by column-0 fence, then dedent

The outer fence opens at column 0. Fences *inside* the prompt body are indented
along with the rest of the body — `code-reviewer.md` contains an indented
` ```bash ` block showing the `git diff` invocation. So: find the first
column-0 ``` line, find the `prompt: |` line after it, take every line until the
next column-0 ``` line, and strip the common leading indentation.

This rule is stable against inner fences, inner blank lines, and inner
indentation, and it needs no YAML parser.

*Alternative considered:* a real YAML parse of the block. Rejected — the block
is not valid YAML (`[MODEL — REQUIRED: choose per...]` is prose, not a scalar),
and stdlib has no YAML.

### D3: Explicit per-template placeholder manifest, not regex discovery

Placeholder tokens are not uniform. `task-reviewer` uses `[BRIEF_FILE]`,
`[GLOBAL_CONSTRAINTS]`, `[BASE_SHA]`; `implementer` also uses prose-shaped slots
like `[Scene-setting: where this fits, dependencies, architectural context]`,
`[directory]`, and `[task name]`. A regex over `[A-Z_]+` would miss half of
them and a regex over `\[.*?\]` would match ordinary bracketed prose in the body.

So the utility carries a manifest: for each template name, a list of
`(token, option, required, kind)` where `kind` is `literal` (substitute the
option's string) or `file` (substitute the named file's contents). Required-ness
comes from the manifest, which is what makes D5's validation possible.

*Trade-off:* the manifest must track upstream template revisions. D5 converts
that from a silent risk into a loud failure.

### D4: Derive conventional inputs from `--plan` and `--task`

The existing scripts already fix the conventions: the workspace is
`<repo-root>/.superpowers/sdd/<plan-basename>/`, the brief is
`task-<N>-brief.md` in it, and the review package is
`review-<base7>..<head7>.diff`. The utility resolves the workspace the same way
`sdd-workspace` does and derives the report, constraints, and output paths from
it. Every derived value stays overridable by an explicit option.

The intended common case is therefore short:

```
projects/agents/utils/dispatch-prompt task-reviewer --plan PLAN --task 7 \
  --brief BRIEF --base BASE --head HEAD
```

with report, diff, constraints, and output path derived. This is deliberate: the
whole failure mode being fixed is that controllers shorten things, so the
correct invocation must already be the short one.

*Alternative considered:* require every path explicitly, for auditability.
Rejected — it recreates the typing surface that decays.

### D4a: `--brief` is the deliberate exception — required, and a path

The brief does not follow D4. It is required explicitly, must exist and be
non-empty, and is substituted as a *path*, never as inlined content (dpr-9).

Two separate failures motivate this. First, controllers have been observed
summarizing briefs into the dispatch message rather than passing the file, which
loses exactly the acceptance criteria a reviewer needs; substituting a path
makes inlining unrepresentable, because there is no option that accepts brief
text. Second, deriving the brief would let a render silently succeed against a
stale or absent `task-<N>-brief.md` — the derived-path convenience that is
correct for the report and the diff is wrong here, because the brief is the one
input whose absence produces a confident, well-formed, and worthless review.

Requiring it costs one argument. That is affordable precisely because everything
else on the command line is derived.

### D5: Verify declared placeholders exist in the resolved template

Before substituting, check that every token in the manifest for the selected
template appears in the resolved template text. If one is missing, exit non-zero
naming the template, the resolved path, and the token.

Without this, a Superpowers upgrade that renames or removes a placeholder would
render a prompt that is silently missing its constraints or its diff pointer —
reproducing the exact failure this change exists to prevent, but harder to
notice because the output looks well-formed.

### D6: Resolve the highest installed Superpowers version, overridable

Scan the plugin cache for version directories, sort by parsed version tuple, and
take the highest that contains the needed template. `--templates-root` (and an
equivalent environment variable) overrides the scan entirely, which is what the
tests use and what a pinned baseline experiment would use.

Failure names every path searched, so a missing or relocated plugin tree is
diagnosable without reading the script.

### D7: Role-distinct output names in the plan workspace

`dispatch-<template>-task-<N>.md`, plus `-round-<R>` for `re-review`, and
`dispatch-code-reviewer.md` for the whole-branch review. Distinct names per role
matter beyond collision avoidance: the brief is shared between implementer and
reviewer, so if the reviewer's rendered rubric landed in a file the implementer
also reads, the implementer would be told exactly what the gate checks.

Writes are atomic — render to a temp file in the workspace and `rename` into
place — so a failed run never leaves a half-written prompt that a controller
could dispatch.

## Risks / Trade-offs

- **Upstream template revision breaks the manifest** → D5 turns it into a
  non-zero exit naming the token, and `--templates-root` allows pinning to a
  known-good version while the manifest is updated.

- **The subagent is handed a path and skims the file instead of following it** →
  This is the one behavior the utility cannot enforce. It is, however, the
  pattern already in production: in the run that motivated this change, every
  subagent that was pointed at `task-N-brief.md` and `global-constraints.md` did
  read them. Pointer-to-file is the proven half; prompt-in-message is the half
  that failed.

- **Controller ignores the utility and composes prompts anyway** → Accepted for
  now. This change is deliberately scoped to the script, with no workflow or
  skill edits, so adoption is a separate decision made with the tool in hand.

- **Plugin cache is absent (headless, CI, fresh machine)** → Non-zero exit
  naming the searched paths, plus `--templates-root` as the escape hatch. The
  utility never falls back to a vendored copy, because a stale vendored rubric
  is the failure mode it exists to prevent.

- **Rendered prompts accumulate in the workspace** → `.superpowers/sdd/` is
  already self-ignoring via the `.gitignore` that `sdd-workspace` writes, so
  these files never reach `git status` or a commit.

## Migration Plan

None required. The utility is additive: nothing invokes it until a caller
chooses to, and no existing file's behavior changes. Rollback is deleting the
two new files and the Makefile target.

## Open Questions

- Should `--context` (the implementer template's free-prose scene-setting slot)
  accept a file, a literal string, or both? Leaning both, with `@path` meaning
  file — but the implementer path is not the motivating case and can be settled
  during implementation.
- Whether the whole-branch `code-reviewer` render belongs in the plan workspace
  at all, given it is not task-scoped. Current answer is yes, for locality with
  the rest of the plan's artifacts.
