# Agent Instructions

These instructions are shared operating guidance for agent harnesses working in
this repository.

## Agentic Infrastructure

If a harness, skill, CLI, installer, or other agentic infrastructure is broken,
stop the current task and escalate to a human. Never work around broken agentic
infrastructure.

## Worktrees

`main` stays clean. Do not develop directly on `main` unless explicitly
instructed. Create a worktree for feature work.

## Dictation

The user relies heavily on voice dictation. Expect transcription errors,
especially around exact words, names, formatting, and casing. When wording looks
off, infer the likely intended meaning from context and call out important
ambiguity before acting on it.
