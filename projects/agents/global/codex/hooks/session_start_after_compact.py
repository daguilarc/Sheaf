#!/usr/bin/env python3
"""Inject a post-compaction reminder into Codex sessions."""

from __future__ import annotations

import json
import sys


REMINDER = (
    "Post-compaction reminder from the Sheaf Codex hook: "
    "If you were working from a plan, checklist, or task list, please review it "
    "after compaction."
)


def main() -> int:
    raw_input = sys.stdin.read()
    try:
        payload = json.loads(raw_input) if raw_input.strip() else {}
    except json.JSONDecodeError:
        return 0

    if payload.get("hook_event_name") != "SessionStart":
        return 0
    if payload.get("source") != "compact":
        return 0

    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": REMINDER,
            }
        },
        sys.stdout,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
