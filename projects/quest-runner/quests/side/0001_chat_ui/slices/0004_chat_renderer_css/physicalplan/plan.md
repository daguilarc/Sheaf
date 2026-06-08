# Chat Renderer And CSS

## Objective

Build the reusable DOM renderer and chat-specific CSS classes for the AG UI transcript component.

Expected outcome: `ChatView.create(container, wsUrl)` renders a read-only transcript with status bar, incremental message updates, auto-scroll behavior, markdown formatting for assistant content, collapsed tool/reasoning panels, and reusable `agui-chat-` CSS that can inherit dashboard theme variables.

## Sequencing

This slice depends on slice 3’s reducer and public `ChatView` API. It remains independent from Quest Runner dashboard routing; slice 5 will load these shared assets from the dashboard shell and wire them to agent selection.

## Key Files And Systems

- `projects/web/src/agui-chat.js`
- `projects/web/src/agui-chat.css`
- `projects/web/tests/agui-chat.test.mjs`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/styles.css`

## Existing APIs To Reuse As-Is

- Slice-3 reducer functions and state shape.
- Browser `WebSocket`, `requestAnimationFrame`, `Map`, and `Set`.
- Existing dashboard CSS custom properties as values to map later; keep shared CSS independent of `--dash-*` names.

## APIs To Extend Or Modify

### Renderer lifecycle

Complete `ChatView.create(container, wsUrl)`:

- Clear the container and append one root element.
- Create a status bar and scrollable transcript container.
- Open the WebSocket and parse incoming JSON messages.
- On each server message, update reducer state and schedule one render with `requestAnimationFrame`.
- Return a handle with container, socket, state, pending animation frame, and listener references.

Complete `ChatView.destroy(handle)`:

- Close the WebSocket if it is open or connecting.
- Cancel any pending animation frame.
- Remove event listeners owned by the view.
- Clear the container content.
- Mark the handle destroyed so late socket callbacks do nothing.

There is no input box and no client-to-server protocol.

### Incremental DOM renderer

Implement append/update behavior:

- Keep `handle.messageNodes: Map<messageId, HTMLElement>`.
- When a message ID first appears in `messageOrder`, create its DOM node and append it.
- For existing streaming messages, update only the content node where practical.
- Remove DOM nodes that no longer exist after `MESSAGES_SNAPSHOT`.
- Use a requestAnimationFrame coalescing guard so bursts of `TEXT_MESSAGE_CONTENT` produce at most one render per frame.

### Auto-scroll

- Treat the user as at-bottom when `scrollHeight - scrollTop - clientHeight <= 50`.
- Before rendering, capture whether the transcript is at-bottom.
- After appending/updating content, scroll to bottom only if it was already at-bottom.
- If the user has scrolled up, suppress auto-scroll until they return to the bottom.

### Message rendering

Implement role-specific rendering:

- `user`: left-aligned bubble, muted `User` label, content in a monospace block.
- `assistant`: primary bubble, basic markdown-to-safe-HTML for paragraphs, inline code, fenced code blocks, bold, and italic. Escape HTML before markdown formatting. Add a blinking cursor element while `isStreaming`.
- `tool`: collapsed panel with button header, chevron, tool name, spinner while open, and expandable monospace args/result body. If the tool result message references a known call, use that tool name in the header.
- `reasoning`: collapsed panel labeled `Thinking`, spinner while streaming, expandable muted monospace body.
- `activity`, `system`, and custom activity rows: compact muted row with label and short content, not a full bubble.

### Status bar

Render:

- During replay: `Loading history...` with event count.
- After `caught_up` with active running run: `Live` and green dot.
- After `caught_up` with no active run: `Complete` and muted dot.
- On WebSocket error, close, or server error: warning text.
- Active steps from `state.activeSteps` as muted labels.

### CSS

Add `projects/web/src/agui-chat.css` with the required classes:

- `.agui-chat-transcript`
- `.agui-chat-bubble`
- `.agui-chat-bubble--user`
- `.agui-chat-bubble--assistant`
- `.agui-chat-bubble--tool`
- `.agui-chat-bubble--reasoning`
- `.agui-chat-activity`
- `.agui-chat-role`
- `.agui-chat-streaming`
- `.agui-chat-status`
- `.agui-chat-tool-header`
- `.agui-chat-tool-body`

Use additional `agui-chat-` classes as needed for root layout, status dots, step chips, code blocks, and collapsed state.

Use CSS custom properties with fallback defaults, for example:

- `--agui-chat-bg`
- `--agui-chat-surface`
- `--agui-chat-surface-muted`
- `--agui-chat-border`
- `--agui-chat-text`
- `--agui-chat-muted`
- `--agui-chat-accent`
- `--agui-chat-warning`
- `--agui-chat-live`

Do not reference `--dash-*` variables inside `agui-chat.css`; dashboard token mapping is done in slice 5.

## Validation Expectations

Extend `projects/web/tests/agui-chat.test.mjs`:

- Use a minimal fake DOM if available locally, or test renderer pure helpers and lifecycle with lightweight hand-written DOM fakes. Do not add npm dependencies.
- Verify `ChatView.create()` appends root/status/transcript elements and `destroy()` closes a fake socket and clears the container.
- Verify text streaming reuses an existing message node.
- Verify tool and reasoning panels toggle expanded/collapsed state.
- Verify auto-scroll stays at bottom when already near bottom and does not force scroll when the user is above the threshold.
- Verify markdown rendering escapes HTML and formats inline code/code blocks/bold/italic.

Manual/browser verification after slice 5 will cover full visual integration in the dashboard.

Run:

```text
node --test projects/web/tests/agui-chat.test.mjs
make -C projects/quest-runner test
```
