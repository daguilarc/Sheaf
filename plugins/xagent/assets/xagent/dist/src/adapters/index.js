import { ClaudeCodeAdapter } from "./claude_code.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { PiAdapter } from "./pi.js";
export function createAdapter(harness) {
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
//# sourceMappingURL=index.js.map