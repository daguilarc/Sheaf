# xagent Subagents

Use this skill when Codex needs an external review opinion, a cross-provider
second pass, or a delegated worker through `xagent`.

Run `xagent` from the active worktree root so the child harness sees the same
files and Git state as the parent Codex session. If you are not at the worktree
root, `cd` there before launching the subprocess.

## Review Routing

For review tasks, prefer a Claude-backed reviewer through xagent:

```shell
xagent run --harness claude_code --model <model> --subagent "<review prompt>"
```

Pick the model by review depth:

- `claude-opus-4.8`: strongest reviewer for subtle architecture, security,
  correctness, or release-risk reviews.
- `claude-sonnet-4.8`: balanced default for ordinary code review.
- `claude-haiku-4.7`: fast, small, inexpensive reviewer for narrow diffs,
  copy checks, or quick sanity passes.

Write the review prompt with the scope and output shape:

- Name the files, diff, PR, or task being reviewed.
- Ask for findings first, ordered by severity.
- Ask for concrete file/line references when available.
- Ask the reviewer to call out uncertainty instead of filling gaps.

## Worker Routing

Use Cursor through xagent when a competent worker pass is useful:

```shell
xagent run --harness cursor --model composer-2.5 --subagent "<worker prompt>"
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
