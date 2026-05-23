# step 3 — physical_planner

**thread:** Sheaf_quest_0001_physical_planner

## output

I need to address the three open issues. Let me update the relevant slice plans and write responses.This is a planning document, not malware. Now I'll update the slice plans to address each issue.

**QP-0001: Suppress initial response.create in manual mode.** Update slice 0001 plan.Now update slice 0003 to explicitly note no auto-response on startup:**QP-0002: Tool outputs need a follow-up `response.create`.** Update slice 0002 to add tool follow-up response behavior in the dispatcher, and update slice 0004 to set the option.Now update slice 0003 to set `responseAfterToolOutput: true`, and slice 0004 to validate the wiring.**QP-0003: Freshness hooks ordering.** Update slice 0006 to introduce a `FreshnessCoordinator` proxy.Now also update slice 0004 to align: the `freshness` dep is optional at the type level (so tools can be tested without it), but the extension's tool-set assembly provides the coordinator-backed hooks.Not malware - planning doc. Update slice 0004 to add the optional `freshness` parameter that slice 0006 will fill in:Now write the response file.I'll proceed with a reasonable response format based on the issue description from my prompt.All three issues addressed. Summary of changes:

**QP-0001 (manual-mode auto-response)** — Slice 0001 now gates the startup `response.create` on turn mode (suppressed for manual). Slice 0003 explicitly notes no auto-response on extension startup. Regression tests added on both sides.

**QP-0002 (tool follow-up response)** — Slice 0002 renamed to cover tool follow-ups. `ToolDispatcher` gains `responseAfterOutput: "never" | "always"` (default off to preserve CLI behavior), forwarded from `AgentStartConfig.responseAfterToolOutput`. Follow-up `response.create` is queued. Slice 0003 sets `responseAfterToolOutput: true`. Slice 0004 adds an end-to-end integration test covering success and error paths.

**QP-0003 (freshness ordering)** — Slice 0006 introduces a `FreshnessCoordinator` owning a stable `FreshnessHooks` reference. Hooks exist before any session; the coordinator delegates to whichever `FreshnessService` is currently attached, no-ops otherwise. Slice 0004 takes an optional `freshness` parameter with a no-op default and hosts a placeholder `FreshnessHooks` interface so tools build and test independently.

Responses written to `physicalplan_issue_responses.md`.

