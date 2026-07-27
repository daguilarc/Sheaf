## Why

Superpowers ships four subagent prompt templates (`implementer-prompt.md`,
`task-reviewer-prompt.md`, `re-review-prompt.md`, `code-reviewer.md`), but the
SDD workflow requires the controller to re-emit each one by hand at dispatch
time. Controllers reliably compress them: measured across 40 real Claude and
Codex review dispatches, the average prompt was ~2.0 KB against a 7.8 KB
template, and **0 of 40** carried the code-quality checklist, the severity
calibration, the "tests verify real behavior, not mocks" check, or the
cross-cutting/call-sites clause.

The failure is structural, not motivational. In the Cursor run of
`add-event-driven-xagent-supervision`, the controller read the full
`task-reviewer-prompt.md` immediately before dispatching any review, then sent
3281 → 1441 → 929 characters across successive tasks as its context filled. In
the same run, `global-constraints.md` — the one input that lived in a file and
was referenced by path — survived all six dispatches unchanged. Content written
to disk does not decay; content the controller must retype does.

## What Changes

- Add `projects/agents/utils/dispatch-prompt`, a repo-local renderer that
  substitutes placeholders into a named Superpowers prompt template and writes
  the result to the plan's SDD workspace, printing the path — the same
  path-returning contract as the existing `task-brief` and `review-package`
  scripts.
- Support the four template names `implementer`, `task-reviewer`, `re-review`,
  and `code-reviewer`, each with its own required-placeholder set.
- Resolve template sources from the installed Superpowers plugin tree, selecting
  the highest installed version, with an explicit override for pinning or
  testing.
- Default `--constraints` to the plan workspace's `global-constraints.md` when
  present, so the common case needs no flag.
- Derive conventional inputs (brief, report, workspace, output path) from the
  plan and task number, so the invocation itself stays short.
- Fail loudly when a required placeholder is unsatisfied, when a template cannot
  be resolved, or when a resolved template no longer carries a declared
  placeholder, rather than emitting a partially-rendered prompt.

## Capabilities

### New Capabilities
- `agents-dispatch-prompt-renderer`: Renders Superpowers subagent prompt
  templates to files with substituted placeholders, resolves template sources
  and workspace-relative defaults, and validates required inputs.

### Modified Capabilities

None. No prompt template, skill body, or workflow instruction is edited by this
change; the utility is additive and opt-in at the call site.

## Impact

- **New:** `projects/agents/utils/dispatch-prompt` and its test.
- **Modified:** `projects/agents/Makefile` (test entry point) only.
- **Depends on:** the Superpowers plugin tree under
  `~/.claude/plugins/cache/claude-plugins-official/superpowers/<version>/skills/`,
  which Codex and Cursor already read from the same location; and the existing
  `sdd-workspace` layout at `<repo-root>/.superpowers/sdd/<plan-basename>/`.
  Both are read-only inputs.
- **Not affected:** `projects/agents/scripts/install.py` renders only `SKILL.md`
  per skill and distributes no companion files, so the utility stays
  repo-invoked and the installer needs no change. No skill text changes, so no
  spec-level behavior of `agents-skill-distribution` changes.
- **Unblocks:** a controlled re-run of the Cursor model baseline in which the
  reviewer prompt is held constant across arms, so measured differences
  attribute to the model rather than to controller transcription.
