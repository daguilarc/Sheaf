# step 25 — polisher

**thread:** Sheaf_quest_0001_slice_0005_polisher

## output

# Polisher Role

You are the polisher for the current slice. Your job is to resolve open polishing
issues reported in `slices/<slice>/polishing_issues.md`.

## Primary Responsibilities

- Read open issues from `slices/<slice>/polishing_issues.md`.
- Implement fixes in code/tests/docs to resolve those open issues.
- Keep fixes focused, maintainable, and aligned with the current slice scope.

## Execution Rules

- Work only from issues listed in `slices/<slice>/polishing_issues.md`.
- Do not invent unrelated scope outside reported polishing issues.
- Run relevant tests for the fixes before completion.
- If an issue implies a major redesign or unresolved ambiguity, follow escalation rules.

## Issue File Handling

- Do not modify `slices/<slice>/polishing_issues.md`.
- Do not mark issue status fields directly.
- Leave issue verification and completion marking to `polisher_reviewer`.

## Polishing issue responses

- When you address open entries in `slices/<slice>/polishing_issues.md` during a pass,
  you MUST append a response section to `slices/<slice>/polishing_issue_responses.md`
  for **each** such issue you touch in that cycle, following the normative format in
  conductor `docs/quest/schemas/issue-responses.md`.
- Each response MUST set `outcome` to `Fixed` or `NotFixed` and include a non-empty
  `explanation` (for `Fixed`, what changed and where; for `NotFixed`, why it was not
  addressed).
- If you disagree with reviewer expectations and will not implement the requested
  change, record `outcome: NotFixed` with your reasoning in the responses file and, when
  the disagreement remains unresolved after normal iteration, escalate via quest-root
  `human_intervention_request.md`.

## Human Intervention Rules

- If you cannot resolve an issue without changing the spec, making major unspecified
  decisions, or performing a redesign-level change, create/update quest-root
  `human_intervention_request.md` and exit.
- If blocked by missing information or conflicting constraints, create/update
  quest-root `human_intervention_request.md` and exit.

## Scope Limits

- Do not modify `physicalplan_issues.md`.
- Do not modify spec files.
- Do not edit role files.
- Only change implementation artifacts needed to resolve open polishing issues,
  `slices/<slice>/polishing_issue_responses.md`, plus quest-root
  `human_intervention_request.md` when escalation is required.



---

Quest Runtime Context
- Quest: main/0001_vs_code_plugin (VS Code Plugin)
- Quest directory: /Users/joyo/Sheaf/quests/main/0001_vs_code_plugin
- Role: polisher
- Current slice: 0005_chat_pane
- Current slice directory: /Users/joyo/Sheaf/quests/main/0001_vs_code_plugin/slices/0005_chat_pane
- Quest documentation directory: /Users/joyo/conductor/docs/quest

Use the quest's `specs/` directory as the implementation specification for this quest. Use the quest documentation directory above as the stable reference for quest schemas, file formats, and workflow rules.

Quest Schemas Reference (`schemas.md`)
```markdown
# Quest Schemas

This document describes the quest runtime files Conductor reads and writes now.
Where older quests still use legacy formats, the compatibility rules are called
out explicitly.

## Quest State File

Path:

```text
<quest_dir>/state.md
```

Canonical format for active v2 quests:

```markdown
# State

- global_step: 18
- machine_name: quest
- machine_path: quests/main/0002_state_machine_abstraction
- state: ExecuteSlice
- updated_at: 2026-04-01T12:00:00Z

## Tags

- active_slice: 0001_example_slice
- quest_number: 2
- quest_slug: state_machine_abstraction
- quest_type: main
```

Rules:

- The first non-empty line is `# State`.
- The state block uses `- key: value` lines.
- Allowed state keys are `global_step`, `machine_name`, `machine_path`, `state`,
  and `updated_at`.
- Quest-root normalized state always uses `machine_name: quest`.
- `global_step` is required for committed v2 top-level quest state and increments
  once per successful top-level runner step commit.
- `machine_path` is repo-relative and points to the quest directory.
- `## Tags` is required, even when empty.
- Tags are string-to-string entries.
- The runner writes `quest_type`, `quest_number`, and `quest_slug` tags.
- During `ExecuteSlice`, `tags.active_slice` is required and must be a slice
  directory name such as `0001_example_slice`.
- Outside `ExecuteSlice` and `PrepareNextSlice`, `active_slice` is omitted.

Compatibility:

- Readers also accept the legacy quest format:

```markdown
# Quest State

state: ExecuteSlice
current_slice: 1
updated_at: 2026-04-01T12:00:00Z
active_slice: 0001_example_slice
global_step: 18
```

- `read_quest_state` auto-detects the format by heading.
- `create_quest` still scaffolds new quests with the legacy `# Quest State`
  layout.
- Once the v2 runner commits a top-level step, it rewrites quest-root `state.md`
  in normalized form.

Supported quest filesystem states:

- `PrePlanning`
- `PhysicalPlanning`
- `ReviewPhysicalPlan`
- `ExecuteSlice`
- `QuestDocumenting`
- `Completed`

The quest machine also uses `PrepareNextSlice` internally, but that logical node
does not persist as a distinct quest filesystem state.

## Slice State File

Path:

```text
<slice_dir>/state.md
```

Format:

```markdown
# Slice State

state: NotStarted|Implementing|PolishingReview|PolishingFix|Done
updated_at: <ISO-8601 UTC timestamp>
```

Rules:

- Slice state files remain in the legacy key/value format.
- The first non-empty line is `# Slice State`.
- The runner persists only the filesystem states above.
- The recursive slice machine also uses logical nodes such as `SliceSetup` and
  `Completed`, but those map onto the persisted slice states rather than changing
  the file schema.

## Step Commit Metadata

Each successful top-level runner step for the canonical v2 runner creates one git
commit whose message carries recursive state-machine metadata.

Commit message shape:

```text
quest-step: 18
state-machine-path: quests/main/0002_state_machine_abstraction
node: ExecuteActiveSliceNode
state-before: ExecuteSlice
state-after: ExecuteSlice

recursive-snapshot-json:
{
  "global_step": 18,
  "snapshot": {
    "child": {
      "child": null,
      "machine_name": "slice",
      "machine_path": "quests/main/0002_state_machine_abstraction/slices/0001_example_slice",
      "node_name": "SliceImplementingNode",
      "role": "implementer",
      "state_after": "Implementing",
      "state_before": "Implementing",
      "tags": {},
      "thread_name": "repo_quest_0002_slice_0001_implementer"
    },
    "machine_name": "quest",
    "machine_path": "quests/main/0002_state_machine_abstraction",
    "node_name": "ExecuteActiveSliceNode",
    "state_after": "ExecuteSlice",
    "state_before": "ExecuteSlice",
    "tags": {
      "active_slice": "0001_example_slice",
      "quest_number": "2",
      "quest_slug": "state_machine_abstraction",
      "quest_type": "main"
    }
  }
}
```

Rules:

- `quest-step` must equal JSON `global_step`.
- Header `state-machine-path`, `node`, `state-before`, and `state-after` must match
  the root JSON snapshot.
- The JSON payload must be pretty-printed multi-line JSON after the
  `recursive-snapshot-json:` marker.
- `snapshot.child` recursively represents nested machine execution for a slice step,
  or `null` for a quest-only step.
- `role` and `thread_name` appear when the step executed an agent-backed node.
- If metadata validation fails, the runner writes
  `logs/commit_metadata_validation_*.md`, creates
  `human_intervention_request.md`, and does not commit the step.
- On a noop top-level step with no filesystem changes, the runner skips the commit
  and does not increment `global_step`.

Compatibility:

- Older quests may still rely on `state_history.md` and older transition commit
  titles.
- Dashboard history readers merge commit metadata with `state_history.md` and prefer
  metadata when the same commit appears in both sources.

## Issue Response Files

Responder-written records of how open reviewer issues were handled. These files are
separate from reviewer-owned issue lists (`physicalplan_issues.md`,
`polishing_issues.md`).

Paths:

```text
<quest_dir>/physicalplan_issue_responses.md
<slice_dir>/polishing_issue_responses.md
```

Write authority:

- `physicalplan_issue_responses.md`: `physical_planner` only.
- `polishing_issue_responses.md`: `polisher` only for the current slice.

Read authority:

- `physical_plan_reviewer` must read `physicalplan_issue_responses.md` when
  verifying open physical plan issues.
- `polisher_reviewer` must read `polishing_issue_responses.md` when verifying open
  polishing issues.

Reviewers must not create, edit, or delete entries in either responses file.

Full normative schema: [`schemas/issue-responses.md`](schemas/issue-responses.md).

## Issue Files

Paths:

```text
<quest_dir>/physicalplan_issues.md
<slice_dir>/polishing_issues.md
```

Format:

```markdown
# Issues

## Issue QP-0001

- status: open|completed
- owner_role: physical_plan_reviewer|polisher_reviewer
- created_at: <ISO-8601 UTC timestamp>
- updated_at: <ISO-8601 UTC timestamp>
- title: <short title>
- details: <markdown text>
- resolution_notes: <markdown text or none>
```

Rules:

- `status` may only be `open` or `completed`.
- Reviewer roles are the only roles allowed to mark issues `completed`.
- `details` and `resolution_notes` may span multiple lines.
- `resolution_notes: none` means the field is unset.

## State History Files

Paths:

```text
<quest_dir>/state_history.md
<slice_dir>/state_history.md
```

Format:

```markdown
# State Transition History

## 2026-03-29T00:00:00Z

- previous_state: <state name>
- next_state: <state name>
- commit: <git commit hash>
- thread_name: <thread name or none>
- notes: <short summary>
```

Current behavior:

- `create_quest` still scaffolds quest-root `state_history.md`.
- Slice scaffolding still creates slice `state_history.md`.
- The canonical v2 runner does not append new transition rows for top-level step
  history.
- Older quests and older runner paths may still contain authoritative history rows,
  and dashboard readers continue to support them.

## Thread Registry

Path:

```text
<quest_dir>/thread_registry.json
```

Format:

```json
{
  "implementer": {
    "thread_name": "myrepo_quest_0002_slice_0001_implementer",
    "harness_kind": "cursor",
    "provider_thread_id": "provider-thread-id",
    "pass_id": 0,
    "round_count": 3,
    "created_at": "2026-03-29T00:00:00Z",
    "last_used_at": "2026-03-29T00:00:00Z"
  }
}
```

Current naming:

- Quest-scoped v2 roles use `<repo>_quest_<quest_number:04d>_<role>`.
- Slice-scoped v2 roles use
  `<repo>_quest_<quest_number:04d>_slice_<slice_number:04d>_<role>`.
- Older threads may still use the legacy slug-based pattern
  `<repo>_quest_<quest_slug>_<role>_0`.

## Execution Config

Path:

```text
<quest_dir>/state_execution_config.yaml
```

Shape:

```yaml
version: 2
harnesses:
  claude_code:
    cli_path: /path/to/claude
profiles:
  implementer:
    harness: cursor
    model: composer-2
    reasoning_effort: high
    idle_timeout_seconds: 3600
    modify_allow:
      - "$currentQuest/human_intervention_request.md"
      - "$currentSlice/implementation_done.md"
      - "$currentSlice/notes/**"
    modify_block:
      - "**"
```

Rules:

- `profiles` keys are role names.
- Allowed harness values are `codex`, `cursor`, and `claude_code`.
- `reasoning_effort` is optional. When present, it must be a string.
- `version: 2` adds optional per-profile `modify_allow` and `modify_block`
  repo-root-relative glob lists.
- `modify_allow` may use only `$currentQuest` and `$currentSlice`.
- `modify_block` must not contain `$` placeholders.
- When both lists match the same path, allow wins.
- The runner refuses to invoke a harness when the target repository working tree is
  not fully clean, including untracked files.
- After each harness turn, the runner compares the repository to the pre-turn
  snapshot, reverts changes outside the role's allowed paths, records those reverts
  in the step log, and sends a follow-up in the same thread telling the agent to
  continue within its allowed paths.
- `version: 1` configs keep legacy behavior: no path-rule enforcement and empty
  parsed allow/block lists.

## Human Intervention Request

Path:

```text
<quest_dir>/human_intervention_request.md
```

Minimum content:

```markdown
# Human intervention requested

**Reason:** <short reason>

<details>
```

Presence of this file blocks further automatic quest progress until a human resolves
the condition.

## Implementer Completion Marker

Path:

```text
<slice_dir>/implementation_done.md
```

Purpose:

- Signals that the implementer believes the full current slice plan is complete.
- The runner advances out of `Implementing` only when this file exists.

## Physical Plan Acceptance Marker

Path:

```text
<quest_dir>/physicalplan_accepted.md
```

Purpose:

- Signals that `physical_plan_reviewer` found no remaining open physical plan issues
  and accepts the quest-level plan review.
- The runner advances out of `ReviewPhysicalPlan` only when this file exists and
  `physicalplan_issues.md` has no open entries.

## Implementation Acceptance Marker

Path:

```text
<slice_dir>/implementation_accepted.md
```

Purpose:

- Signals that `polisher_reviewer` found no remaining open polishing issues and
  accepts the current slice implementation.
- The runner advances the slice to logical completion only when this file exists and
  `polishing_issues.md` has no open entries.
```

Task:
Fix the open issues in `polishing_issues.md`. Add resolution notes but do not close issues yourself.I'll start by reading the polishing issues file and understanding the current slice context.Now let me look at the existing tests for SessionController to understand the testing patterns.Now let me look at the slice spec to understand the requirements properly.Now I have a complete understanding. Let me look at the existing chatModel test to understand testing patterns better.Now I have enough context. Let me plan the fixes:

The polishing issue requires that the following paths produce `error` bubbles in the chat model:
1. `commitAudioAndCreateResponse()` rejection in `CommitAndRespond()`
2. Microphone capture failure via `onError`
3. Unexpected connection loss (`connection_lost`)

For #3, the order is currently: `onSessionEnded` fires → `chatModel.reset(reason)` which clears bubbles and pushes a "Session ended: connection_lost" context bubble → then `HandleSessionEndedUnexpectedly` runs but doesn't add to chat. I need to add a `recordError` for the connection lost path after reset so the error bubble is preserved alongside the context bubble.

Let me also check `existing tests`:Now I'll implement the fixes. The approach:

1. **`CommitAndRespond()`**: Add `chatModel.recordError()` on catch.
2. **Microphone `onError`**: Add `chatModel.recordError()` before stopping.
3. **`connection_lost`**: `onSessionEnded` resets the chat (clears bubbles). Need to add an error bubble after the reset. The right place is in `HandleSessionEndedUnexpectedly` where we know reason is connection_lost — call `recordError` on the chat model there.

Let me look at the spec note about session-fatal failures: the chat model `reset()` clears and adds a context bubble. So adding `recordError` after reset will result in: context bubble + error bubble. That preserves the existing context behavior.Now for `connection_lost` — the issue is that `onSessionEnded` fires first (calling `reset` which clears chat and adds context bubble), then `HandleSessionEndedUnexpectedly` runs. I'll add the error bubble in the unexpected handler so it sits after the context bubble.Now let me add tests verifying these chat error bubbles through SessionController/ChatModel behavior. Let me check the existing test setup more carefully:Now let me add tests. I need to test all three new paths:Now let me look at how `RealtimeAgentSession.commitAudioAndCreateResponse` is normally returned so I can rejected it:Now let me check that `onSessionEnded` info type matches:Good. The cast `{ reason: "connection_lost" } as never` should work. Now let me run the tests:All 47 tests pass, including the 4 new tests for the chat error paths. Now let me also verify the build:Build succeeds (the import.meta warning is pre-existing and unrelated). Now I need to write the polishing issue response file:Let me verify the final state of changes:All changes are scoped correctly: source/test code in `apps/vscode-extension/`, plus the new `polishing_issue_responses.md`. The polishing issues file itself is untouched.

Summary of fixes for POL-0001:

- `CommitAndRespond()`: now calls `chatModel.recordError(\`Commit failed: ${message}\`)` on `commitAudioAndCreateResponse()` rejection.
- Microphone `onError`: now calls `chatModel.recordError(\`Microphone error: ${message}\`)` before stopping the session.
- `HandleSessionEndedUnexpectedly` (connection_lost): now calls `chatModel.recordError("Connection to OpenAI was lost.")` after the `onSessionEnded` reset, so both the session-ended context bubble and the error bubble are present.
- Added 4 focused tests in `test/sessionController.test.ts` that drive these paths through a real `ChatModel` and assert error bubbles directly. All 47 tests pass and the build succeeds.
- Wrote `polishing_issue_responses.md` with `outcome: Fixed` per the conductor schema. Issue status in `polishing_issues.md` is left untouched for the reviewer.

