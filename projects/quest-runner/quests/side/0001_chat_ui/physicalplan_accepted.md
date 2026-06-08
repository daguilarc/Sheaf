# Physical Plan Accepted

Quest: side/0001_chat_ui (Chat UI)
Reviewer: physical_plan_reviewer
Date: 2026-06-08

## Summary

All five slice physical plans are accepted. No open physical-plan issues remain.

## Slices reviewed

1. `0001_server_stream_core` — `ChatEventBus` + `ChatStreamSession` (replay/live with
   sequence dedup) and a log-path resolution helper. Reuses `QuestLogToAguiMapper` and
   `dashboard_slice` helpers as-is. Tests cover pub/sub, replay batching, live stream,
   dedup, malformed-line handling, and send-failure cleanup.
2. `0002_service_harness_wiring` — `flask-sock` dependency, `Sock` route at
   `/api/dashboard/agent_log/stream`, `QuestService.chat_event_bus`, harness
   `event_bus` publish in `HarnessJsonlLogSink._append`, and the `/assets/web/<file>`
   no-cache static route. The `event_bus` threading path is now fully specified through
   `RunContext` and the state-machine node (see QP-0001 below).
3. `0003_agui_reducer` — reusable `agui-chat.js` reducer and `ChatView` API shell with
   a complete event dispatch table and Node `--test` coverage for every event type the
   mapper can emit.
4. `0004_chat_renderer_css` — DOM renderer, auto-scroll, role-specific rendering,
   markdown-to-safe-HTML, status bar, and `agui-chat-` CSS with themeable custom
   properties (no `--dash-*` coupling).
5. `0005_dashboard_integration` — `index.html` asset tags, `styles.css` token mapping,
   `app.js` lifecycle (create/destroy `ChatView`, seq-guarded), removal of the raw
   JSONL `<pre>` view with no fallback toggle.

## Verification notes

- Plan API claims verified against the codebase: `QuestLogToAguiMapper.consume/flush`,
  `dashboard_slice` helpers, `HarnessJsonlLogSink._append` + `sequence` assignment,
  `create_app`/`_quest_context`/`_no_cache`, and the `app.js` raw `<pre>` rendering.
- Spec asserts `/assets/web/` is already served; it is not, but slice 2 adds the route
  conditionally, so this spec inaccuracy is correctly handled by the plan.
- Slice ordering is dependency-correct and sequentially executable: 1 → 2 → 3 → 4 → 5.

## Issues

- QP-0001 (closed/completed): Slice 2 originally omitted the `RunContext` /
  state-machine hop when threading `event_bus` from `QuestService` to the harness sink.
  Planner revised the plan to add `state_machine/context.py` and
  `state_machine/quest_v2_nodes.py` to Key Files and to describe threading via
  `RunContext` into `perform_role_harness_sequence` (`_begin_harness_round`) and on to
  `HarnessJsonlLogSink`, sharing one `chat_event_bus` instance with the background-run
  path. Verified and accepted.
