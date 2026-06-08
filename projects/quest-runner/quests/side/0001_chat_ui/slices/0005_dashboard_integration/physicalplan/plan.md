# Dashboard Integration

## Objective

Replace the dashboard agent raw JSONL `<pre>` view with the reusable chat transcript component and complete end-to-end verification.

Expected outcome: the Quest Runner dashboard loads `/assets/web/agui-chat.css` and `/assets/web/agui-chat.js`, maps dashboard theme tokens into `--agui-chat-*` variables, creates a `ChatView` WebSocket transcript when an agent is selected, destroys it when the selected agent/step/page changes, and no longer renders a raw JSONL dump or raw-view toggle.

## Sequencing

This is the final integration slice. It depends on the server route from slice 2 and the browser component from slices 3 and 4.

## Key Files And Systems

- `projects/quest-runner/src/quest_runner_service/dashboard_assets/index.html`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/app.js`
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/styles.css`
- `projects/quest-runner/src/quest_runner_service/api.py`
- `projects/quest-runner/tests/test_dashboard_shell.py`
- `projects/quest-runner/tests/test_dashboard_slice.py`
- `projects/web/src/agui-chat.js`
- `projects/web/src/agui-chat.css`
- `projects/web/tests/agui-chat.test.mjs`

## Existing APIs To Reuse As-Is

- Existing dashboard SPA state and rendering pattern in `app.js`.
- Existing `/api/dashboard/agent_log` response for metadata and step sibling selection.
- `QuestBase()` and `Qs(...)` for URL query construction.
- `window.ChatView.create(container, wsUrl)` and `window.ChatView.destroy(handle)` from shared web assets.
- Existing dashboard CSS tokens in `styles.css`.

## APIs To Extend Or Modify

### HTML asset loading

In `index.html`, load shared chat assets before `app.js`:

```html
<link rel="stylesheet" href="/assets/web/agui-chat.css">
<script src="/assets/web/agui-chat.js"></script>
```

Keep `app.js` as the dashboard module script. The shared chat file is a browser global script, not an imported module.

### Theme mapping

In `styles.css`, add dashboard-scoped mappings on `.dash-root` or the chat container:

```css
--agui-chat-bg: var(--dash-bg);
--agui-chat-surface: ...;
--agui-chat-text: ...;
...
```

Use existing dashboard token names and colors. Do not duplicate the full chat CSS in dashboard styles.

### Agent panel lifecycle

Modify `app.js` around `RefreshAgentLog()` and `RenderAgentsPanel(...)`:

- Keep fetching `/api/dashboard/agent_log` to get metadata and log sibling step options.
- Stop reading or rendering `log.jsonl_raw`.
- Build a WebSocket URL from `window.location`:
  - Protocol: `wss:` when `location.protocol === "https:"`, otherwise `ws:`.
  - Host: `location.host`.
  - Path: `/api/dashboard/agent_log/stream`.
  - Query: `QuestBase()`, selected `agent_key`, and selected `step` when present.
- Render a chat container element in the log panel, for example:

```html
<div id="dash-agent-chat" class="dash-agent-chat"></div>
```

- After setting `main.innerHTML`, call `ChatView.create(chatContainer, wsUrl)` and store the handle in `state.contentCache.chatHandle`.
- Before creating a new handle, destroy any previous handle.
- When switching agents, changing step, changing page, changing project, changing quest, or replacing `state.contentCache`, destroy the previous chat handle first.
- Increment or reuse `state.agentLogRequestSeq` so stale metadata fetches do not create a chat for an old selection.
- If `window.ChatView` is missing, show an error row; do not fall back to raw JSONL.

Add a small helper:

```javascript
function DestroyActiveChat() {
  if (state.contentCache.chatHandle && window.ChatView) {
    window.ChatView.destroy(state.contentCache.chatHandle);
  }
  state.contentCache.chatHandle = null;
}
```

Call this helper before every `state.contentCache = {}` assignment and before recreating a transcript for a new agent/step.

### Remove raw JSONL UI

Remove:

- The `<pre class="dash-pre dash-pre--raw">...</pre>` log body.
- Any code that depends on `log.jsonl_raw` for display.

Do not add a raw view toggle or fallback.

## Cleanup

After integration:

- Remove any temporary renderer placeholders left from slice 3.
- Ensure dashboard tests do not assert raw JSONL rendering.
- Keep `/api/dashboard/agent_log` in place for metadata and step siblings unless a later quest explicitly replaces it.

## Validation Expectations

Update tests:

- `test_dashboard_shell.py`: dashboard HTML includes `/assets/web/agui-chat.css` and `/assets/web/agui-chat.js`; `/assets/web/agui-chat.css` and `/assets/web/agui-chat.js` are served with no-cache headers.
- Dashboard JS Node tests: add focused tests to a utility module if URL construction or chat lifecycle helpers are extracted. If helpers remain in `app.js`, keep tests at the shell/static level and cover reducer/renderer in `projects/web/tests/agui-chat.test.mjs`.
- Existing `test_dashboard_slice.py` should continue to pass for `/api/dashboard/agent_log` metadata and log sibling selection.
- `projects/web/tests/agui-chat.test.mjs` should pass after final lifecycle behavior is in place.

Manual verification:

- Start Quest Runner with a project that has existing JSONL logs.
- Open `/dashboard?project=...&quest_type=...&quest_number=...&page=agents`.
- Select an agent and verify history renders as chat, not raw JSONL.
- Change the step selector and verify the previous WebSocket closes and a new transcript loads.
- Start or continue a quest run and verify live events appear without refresh.
- Verify auto-scroll, collapsed tool panels, collapsed reasoning panels, status bar `Loading history...`, `Live`, `Complete`, and disconnect/error states.
- Verify navigating away from Agents and back does not leave duplicate WebSocket sessions.

Run:

```text
node --test projects/web/tests/agui-chat.test.mjs
make -C projects/quest-runner test
```
