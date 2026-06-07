# Issue response files

Normative schema for files where `physical_planner` and `polisher` record whether
each open reviewer issue was addressed. These files are separate from reviewer-owned
issue lists (`physicalplan_issues.md`, `polishing_issues.md`).

## Paths

```text
<quest_dir>/physicalplan_issue_responses.md
slices/<slice>/polishing_issue_responses.md
```

## Physical plan issue responses

Path: `<quest_dir>/physicalplan_issue_responses.md`

Purpose: After `physical_plan_reviewer` leaves open entries in
`physicalplan_issues.md`, the `physical_planner` records how it responded before the
next review cycle.

Write authority: `physical_planner` only for this file at quest root.

Read authority: `physical_plan_reviewer` (and any role that needs context) must read
this file when verifying issues; reviewers must not write to it.

## Polishing issue responses

Path: `slices/<slice>/polishing_issue_responses.md`

Purpose: After `polisher_reviewer` leaves open entries in `polishing_issues.md`, the
`polisher` records how it responded before the next review cycle.

Write authority: `polisher` only for this file in the current slice.

Read authority: `polisher_reviewer` (and any role that needs context) must read this
file when verifying issues; reviewers must not write to it.

## File format

Each file is markdown with a fixed top-level heading and one section per issue
response in chronological or round order.

```markdown
# Issue responses

## Response <ISSUE_ID> <ISO-8601 UTC timestamp>

- issue_id: <same id as in the matching issues file, e.g. QP-0001 or PL-0002>
- outcome: Fixed|NotFixed
- explanation: <markdown text>
```

For the same `issue_id`, multiple `## Response ...` sections may exist across rounds
(newest-first or oldest-first), as long as each section is tied to `issue_id` and
timestamp.

### Field rules

- `issue_id` MUST match the heading id in the corresponding issues file
  (`## Issue <ISSUE_ID>`).
- `outcome`:
  - `Fixed` means the responder believes the issue is fully addressed; the reviewer
    still verifies and may keep the issue `open` or mark it `completed`.
  - `NotFixed` means the responder did not implement a fix; `explanation` MUST state
    why (blocked, out of scope, disagreement, needs human decision, etc.).
- `explanation` MUST be non-empty markdown: for `Fixed`, how the issue was resolved
  (what changed, where); for `NotFixed`, the reason it was not fixed.
- Timestamps SHOULD be UTC ISO-8601, e.g. `2026-03-29T12:00:00Z`.

### Empty file

If no responses have been written yet, the file may be absent or contain only:

```markdown
# Issue responses
```

## Relationship to issues files

- Reviewers continue to own `status: open|completed` in `physicalplan_issues.md` and
  `polishing_issues.md` only.
- Responders MUST NOT mark issues `completed`; they only append to the appropriate
  issue responses file.
- Reviewers MUST consult the issue responses file when re-checking open issues.
- If reviewer and responder positions cannot be reconciled after one more focused
  update cycle, the reviewer escalates via quest-root `human_intervention_request.md`
  (see `docs/quest/workflow.md`).
