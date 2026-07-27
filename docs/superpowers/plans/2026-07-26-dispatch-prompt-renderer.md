# Plan: dispatch-prompt renderer

## Task 1: Add the dispatch-prompt template renderer

Add `projects/agents/utils/dispatch-prompt`, a Python 3 (stdlib-only) utility
that renders a named Superpowers subagent prompt template to a file and prints
that file's path, so a controller dispatches a subagent by path instead of
retyping the template body into its own message.

Requirements are `dpr-1` through `dpr-9` in
`openspec/changes/add-dispatch-prompt-renderer/specs/agents-dispatch-prompt-renderer/spec.md`.
Design decisions D1-D7 and D4a are in
`openspec/changes/add-dispatch-prompt-renderer/design.md`.

Scope:
- Support template names `implementer`, `task-reviewer`, `re-review`,
  `code-reviewer`.
- Resolve templates from the installed Superpowers plugin tree (highest
  version), overridable by `--templates-root` or `SUPERPOWERS_TEMPLATES_ROOT`.
- Emit only the `prompt: |` body, dedented, with the markdown wrapper,
  dispatch scaffold, placeholder docs, and returns note excluded.
- Substitute via an explicit per-template placeholder manifest.
- Require `--brief` explicitly; it must exist, be non-empty, and be
  substituted as a path, never as inlined content.
- Derive report, constraints, diff, and output paths from `--plan` plus
  `--task` using the `sdd-workspace` convention; keep all derived values
  overridable.
- Fail loudly on unresolvable template source, template drift, unsatisfied
  slots, or a bad brief. Write no output file on any failure.
- Test with stdlib `unittest`, wired into `make -C projects/agents test`.

Out of scope: editing any prompt template, skill body, or workflow
instruction; model selection; dispatching the subagent.
