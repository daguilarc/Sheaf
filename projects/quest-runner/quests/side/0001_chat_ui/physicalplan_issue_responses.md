# Issue responses

## Response QP-0001 2026-06-08T04:56:55Z

- issue_id: QP-0001
- outcome: Fixed
- explanation: Updated slice 2's `physicalplan/plan.md` to include `state_machine/context.py` and `state_machine/quest_v2_nodes.py` in Key Files, and expanded the harness publishing section to require threading `event_bus` through `QuestService._run_quest_locked`, `quest_runner.run_quest`, `quest_runner_v2.run_quest_v2`, `RunContext`, the state-machine node, `perform_role_harness_sequence`, and finally `HarnessJsonlLogSink`. The plan now also explicitly states that `schedule_run_quest` uses the same `_run_quest_locked` path and therefore the same `QuestService.chat_event_bus` instance as WebSocket subscribers.
