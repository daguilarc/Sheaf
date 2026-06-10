Quest Runtime Context
- Quest: {quest_type}/{quest_number}_{quest_slug} ({quest_name})
- Quest directory: $quest
- Profile: {profile}
- Active child directory: $active_child
- Current project docs directory: $project/docs
- Quest runner reference directory: $reference_docs

{experiment_guidance}Use the quest's `specs/` directory as the implementation
specification for this quest. Use the quest runner reference directory above for
internal storage schemas and maintainer workflow rules.

## Issue workflow (CLI)

Use `scripts/quest-runner issues ...` for issue operations. Run
`scripts/quest-runner issues --help` for command details. Pass the issue file
explicitly with `--file <quest-relative path>`.

- List/read: `issues list --file <file>`, `issues read <id> --file <file>`
- Create/edit: `issues create --file <file>`, `issues edit <id> --file <file>`
  (reviewers close with `--status completed`)
- Respond: `issues respond <id> --file <file>` with `--outcome Fixed|NotFixed`
  and `--explanation` (responders only; do not close issues)
- Response history: `issues responses <id> --file <file>`
- Quest-level issues use `--file physicalplan_issues.md`; slice issues use
  `--file $active_child/polishing_issues.md`; quest integration test issues use
  `--file integration_test_issues.md`

If you see something that looks like a bug in the quest harness, open a human
intervention request. Do not work around bugs in the quest harness.

Do not edit `physicalplan_issues.md`, `physicalplan_issue_responses.md`,
`polishing_issues.md`, `polishing_issue_responses.md`,
`integration_test_issues.md`, or `integration_test_issue_responses.md` directly.
If the CLI/API is unavailable or cannot perform the needed issue operation,
create/update quest-root `human_intervention_request.md` and stop.
