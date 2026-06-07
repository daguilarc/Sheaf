# Freshness Model

The VS Code extension tracks editor state the agent has observed and pushes
structured context when that state may be stale. Freshness pushes inform the
model; they do not automatically request a response.

## Observation model

The freshness coordinator tracks three kinds of stale state:

| Kind | Trigger |
|---|---|
| `file_changed_since_last_read` | A file the agent read may have changed on disk or in an unsaved buffer. |
| `viewport_changed_since_last_check` | The visible editor viewport may differ from the last observation. |
| `cursor_changed_since_last_check` | The cursor position may differ from the last observation. |

User-driven edits, scrolling, tab switches, and selection changes can emit one
notification per stale kind until the agent observes that state again.

Outside-workspace documents are ignored.

## Clearing freshness

Freshness is cleared when the agent re-observes the relevant state:

| Kind | Cleared by |
|---|---|
| File | `code_read` or a read-producing navigation tool |
| Viewport | Visible-range request or a navigation tool that returns visible range |
| Cursor | Visible-range read or cursor move via navigation tools |

## Mutation suppression

Agent-caused editor mutations do not trigger freshness notifications. This
includes:

- `modifyFile` buffer edits
- Navigation tools that change cursor or viewport

The extension avoids notifying the model about its own tool side effects.

## Context delivery

Freshness messages serialize through `sendStructuredContext()` as user
`input_text` with a stable JSON envelope:

```json
{
  "kind": "file_changed_since_last_read",
  "source": "vscode",
  "payload": { "file": "src/example.ts" },
  "summary": "src/example.ts changed since last read"
}
```

The chat pane shows summarized context bubbles for these pushes.

## Related docs

- [VS Code extension reference](../reference/vscode-extension.md)
- [Library API reference](../reference/api.md) — `StructuredContextMessage`
- [Session lifecycle](session-lifecycle.md)
