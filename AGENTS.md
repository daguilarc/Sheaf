<!-- sheaf-agents-managed: DO NOT EDIT; source=projects/agents/global/AGENTS.md -->

# Agent Instructions

These instructions are shared operating guidance for agent harnesses working in
this repository.

## Agentic Infrastructure

If a harness, skill, CLI, installer, or other agentic infrastructure is broken,
stop the current task and escalate to a human. Never work around broken agentic
infrastructure.

## OpenSpec Workflow

Use the OPSX/OpenSpec workflow for planned changes when an OpenSpec change is
active or requested. If `openspec` is not available on PATH, stop and report the
infrastructure failure instead of bypassing the workflow.

## Commits

When the user explicitly says "commit what we have", stage all current working
directory changes with `git add -A` and commit them together. Do not limit that
phrase to files related to the current chat or task. If there are no staged
changes after `git add -A`, report that there is nothing to commit.

## Dictation

The user relies heavily on voice dictation. Expect transcription errors,
especially around exact words, names, formatting, and casing. When wording looks
off, infer the likely intended meaning from context and call out important
ambiguity before acting on it.
