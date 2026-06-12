# Software Principles

Use this skill when making engineering decisions, reviewing code, implementing
changes, or deciding whether to continue after finding a suspicious condition.

Write good, clean code. Prefer simple, explicit designs over cleverness.

Maintain clean contracts between components. Make boundaries explicit, keep
responsibilities clear, and avoid accidental coupling.

Prefer assertions for impossible states. It is often better to fail loudly on
something that should not happen than to fail gracefully and hide a bug. Silent
recovery can turn real defects into confusing downstream behavior.

Keep tests green. Do not change tests to work around bugs. If a test is wrong,
say so clearly and explain why before changing it.

If a harness, skill, CLI, installer, or other agentic infrastructure is broken,
stop the current task and escalate to a human. Never work around broken agentic
infrastructure.

If you see something, say something. Surface suspicious behavior, weak
assumptions, inconsistent design, missing tests, or risks likely to matter.
