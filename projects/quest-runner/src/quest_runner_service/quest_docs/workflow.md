# Quest Workflow Reference

## Role Routing

- `PhysicalPlanning` -> `physical_planner`
- `ReviewPhysicalPlan` -> `physical_plan_reviewer`
- `ExecuteSlice` + `Implementing` -> `implementer`
- `ExecuteSlice` + `PolishingReview` -> `polisher_reviewer`
- `ExecuteSlice` + `PolishingFix` -> `polisher`
- `QuestDocumenting` -> `documenter`

The canonical recursive runner reuses one thread per role scope:

- quest-scoped roles: `<repo>_quest_<quest_number:04d>_<role>`
- slice-scoped roles: `<repo>_quest_<quest_number:04d>_slice_<slice_number:04d>_<role>`

## Prompt Contract

Every role message should make the following explicit:

- current quest
- current role
- current slice, or that the pass is quest-scoped
- absolute path to this quest reference directory

The first message in a role thread includes:

1. the full role file from `roles/<role>.md`
2. runtime context
3. the current task instruction

Later messages reuse the same thread and include:

1. runtime context
2. the current task instruction

## Ownership Rules

- `physical_planner` writes slice plans and slice scaffolding, not code.
- `physical_planner` must fully plan all work explicitly required by the quest spec.
- `physical_planner` must not leave stubs or placeholder planning for
  spec-defined work.
- `physical_planner` must escalate to a human if further research is required to
  complete the plan.
- On the initial `PhysicalPlanning` pass, `physical_planner` creates the slice plans
  and scaffolding from the quest specs.
- `physical_planner` appends to quest-root `physicalplan_issue_responses.md` when
  addressing open physical plan issues; only `physical_planner` may write that file.
- When `ReviewPhysicalPlan` sends the quest back to `PhysicalPlanning`, the planner
  should address the open review issues, update the plans, and record per-issue
  responses in `physicalplan_issue_responses.md` rather than receiving the initial
  planning task again.
- `physical_plan_reviewer` writes only quest-level `physicalplan_issues.md` and must
  read `physicalplan_issue_responses.md` when verifying planner follow-up; reviewers
  must never write to `physicalplan_issue_responses.md`. When the issue list is clear
  and the review is accepted, it creates `physicalplan_accepted.md`.
- `implementer` writes code/tests for the current slice and creates
  `implementation_done.md` when complete.
- `polisher_reviewer` writes only slice-level `polishing_issues.md` and must read
  `slices/<slice>/polishing_issue_responses.md` when verifying polisher follow-up;
  reviewers must never write to `polishing_issue_responses.md`. When the issue list is
  clear and the review is accepted, it creates `implementation_accepted.md`.
- `polisher` fixes open polishing issues but does not close them; only `polisher` may
  append to `slices/<slice>/polishing_issue_responses.md` for that slice.
- `documenter` writes only the current project's `docs/` directory, normally
  `projects/<project>/docs/`.

Normative format for issue response files: `docs/quest/schemas/issue-responses.md`.

## Issue Lifecycle

- Reviewers create and close issues in reviewer-owned issue files; statuses remain only
  `open` or `completed`.
- Responders record how they addressed each open issue they touch by appending sections
  to the matching issue responses file (`physicalplan_issue_responses.md` or
  `polishing_issue_responses.md`); they must not mark reviewer-owned issues
  `completed`.
- Reviewers read issue responses when re-checking open issues; they must not edit
  response files—if a response is inadequate, they update the issue and/or escalate.
- If an issue stays `open` across more than one cycle after the responder had a chance
  to reply, the reviewer enriches the issue with actionable detail (what was checked,
  what is still wrong, what would close it).
- If reviewer and responder positions remain in conflict after one more focused update
  cycle (including `Fixed` vs reviewer-disagrees or `NotFixed` due to scope/spec
  dispute), the reviewer escalates via quest-root `human_intervention_request.md`.
- Non-reviewer roles may add implementation notes or fixes, but must not mark
  reviewer-owned issues `completed`.
- If work cannot proceed without a major decision or clarification, write
  `human_intervention_request.md` and stop.

## Slice Execution Loop

1. Runner selects the current role from quest state and slice state.
2. Runner sends the role prompt and task.
3. Implementer always receives an additional follow-up asking it to create
   `implementation_done.md` if the slice is complete.
4. Reviewers receive an additional follow-up only when their issue list is clear,
   asking them to create `physicalplan_accepted.md` or `implementation_accepted.md`.
5. Runner evaluates file-based predicates and issue-file state.
6. Runner records each successful top-level step in git (one commit per step, with
   recursive metadata in the commit message). Legacy quests may still have
   `state_history.md` entries from older runners, and dashboard readers merge both
   history sources.
