import type { HarnessName } from "../events.js";
import type { HarnessAdapter } from "./types.js";
import { ClaudeCodeAdapter } from "./claude_code.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { PiAdapter } from "./pi.js";

export function createAdapter(harness: HarnessName): HarnessAdapter {
  switch (harness) {
    case "codex":
      return new CodexAdapter();
    case "cursor":
      return new CursorAdapter();
    case "claude_code":
      return new ClaudeCodeAdapter();
    case "pi":
      return new PiAdapter();
  }
}
