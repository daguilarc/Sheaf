# xagent Subagents

Use this skill when Codex needs an external review opinion, a cross-provider
second pass, or a delegated worker through packaged `xagent`.

Prefer the xagent Codex plugin launcher instead of assuming a bare `xagent`
binary exists on `PATH`. In this repository, the source launcher is:

```shell
plugins/xagent/scripts/xagent
```

When xagent is installed as a Codex plugin in another repository, resolve the
launcher from the installed plugin package and run it from the active worktree
root. The xagent executable code comes from the plugin assets; the child
harness working directory belongs to the active repository. Packaged xagent
logs default to `/Users/joyo/Sheaf/data/xagent`; set `XAGENT_LOG_ROOT` only
when intentionally validating or isolating logs somewhere else.

Sandboxed agents can invoke xagent even when they cannot complete a real run.
If the central log root cannot be written, xagent reports a structured
`log_root_unavailable` error. If the selected child harness lacks auth,
network, process, or cache permissions, xagent reports the harness-specific
failure. Surface those failures instead of silently switching tools.

When xagent launches the Codex harness, it passes Codex's explicit
`--dangerously-bypass-approvals-and-sandbox` flag so the xagent-spawned Codex
child does not stop for command approvals or inherit a restrictive sandbox.
Use this only through xagent; do not copy that flag into unrelated workflows.

If the packaged launcher or tool cannot be invoked, surface the broken agentic
infrastructure. Do not rebuild xagent ad hoc from a guessed Sheaf checkout or
silently fall back to a different agent path.

## Review Routing

For review tasks, prefer a Claude-backed reviewer through xagent:

```shell
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "<review prompt>"
```

Pick the model by review depth:

- `opus`: strongest reviewer for subtle architecture, security, correctness,
  or release-risk reviews.
- `sonnet`: balanced default for ordinary code review.
- `haiku`: fast, small, inexpensive reviewer for narrow diffs, copy checks, or
  quick sanity passes.

Do not use stale dotted model names such as `claude-opus-4.8`; local Claude
Code accepts aliases such as `opus` or full names such as `claude-opus-4-8`.
If a different model alias is needed, verify it with local Claude Code help
before retrying. Do not silently downgrade after a model rejection.

Write the review prompt with the scope and output shape:

- Name the files, diff, PR, or task being reviewed.
- Ask for findings first, ordered by severity.
- Ask for concrete file/line references when available.
- Ask the reviewer to call out uncertainty instead of filling gaps.

## Worker Routing

Use Cursor through xagent when a competent worker pass is useful:

```shell
plugins/xagent/scripts/xagent run --harness cursor --model composer-2.5 --subagent "<worker prompt>"
```

Treat Composer 2.5 as a solid worker for straightforward implementation,
cleanup, alternate drafts, or exploratory passes.

For the trickiest implementation tasks, prefer a GPT or Codex-backed worker
agent instead of Composer. Use the strongest available GPT/Codex worker when
the task needs deep reasoning, careful repository integration, or high-stakes
correctness.

## Failure Handling

If `xagent`, Claude Code, Cursor Agent, or a requested model cannot be launched
as instructed, surface the failure. Do not silently switch tools or work around
broken agentic infrastructure.
