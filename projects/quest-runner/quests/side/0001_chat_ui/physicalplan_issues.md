# Issues

## Issue QP-0001

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-06-07T00:00:00Z
- updated_at: 2026-06-07T00:00:00Z
- title: Slice 2 omits RunContext/state-machine hop when threading event_bus to the harness sink
- details: Slice 2 (service_harness_wiring) plans to thread an optional event_bus from QuestService._run_quest_locked through quest_runner.run_quest and quest_runner_v2.run_quest_v2 into "the perform_role_harness_sequence(...) call path that constructs HarnessJsonlLogSink". The actual call path is: _run_quest_locked -> run_quest -> run_quest_v2 (quest_runner_v2.py:39) -> constructs RunContext (state_machine/context.py) -> execute_v2_top_level_step -> state-machine node (state_machine/quest_v2_nodes.py:101) -> perform_role_harness_sequence (quest_runner.py:67) -> HarnessJsonlLogSink (quest_runner.py:134). perform_role_harness_sequence is invoked by the node using RunContext (ctx) fields (e.g. ctx.conductor_repo_path, ctx.role_step_seq_box at quest_v2_nodes.py:102-118), not directly from run_quest_v2.

Problem: The plan's "Key Files And Systems" list and its threading description omit state_machine/context.py (RunContext) and state_machine/quest_v2_nodes.py. event_bus cannot reach perform_role_harness_sequence without (a) adding an event_bus field to RunContext, (b) populating it in run_quest_v2 where RunContext is constructed, and (c) having the state-machine node pass ctx.event_bus into perform_role_harness_sequence. An implementer following the current plan will hit this RunContext boundary mid-slice with no guidance, causing avoidable churn or an ad-hoc workaround that diverges from the existing context-threading convention (conductor_repo_path, quest_docs_dir, role_step_seq_box are all carried via RunContext today).

Resolution criteria: Slice 2's physicalplan/plan.md should (1) add state_machine/context.py and state_machine/quest_v2_nodes.py to its Key Files, and (2) describe the event_bus threading via RunContext: add an event_bus field to RunContext, set it when run_quest_v2 constructs RunContext, and pass ctx.event_bus from the node into perform_role_harness_sequence, which forwards it to HarnessJsonlLogSink. The plan must also confirm the scheduled background-run path (schedule_run_quest -> _run_quest_locked) uses the same QuestService.chat_event_bus instance so live events reach subscribers.
- resolution_notes: none
