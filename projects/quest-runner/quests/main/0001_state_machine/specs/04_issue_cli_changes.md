# Proposed Issue CLI Changes

## Goal

Keep issues first-class while removing hard-coded issue scopes such as
`physicalplan` and `polishing` from the runner and CLI.

The CLI should operate on an issue file path relative to the quest root. The
workflow owns the issue files and declares their paths. The runner and CLI know
how to read and mutate issue files, but do not know what those files mean in a
particular workflow.

## Current behavior to replace

Current commands use workflow-specific scopes, for example:

```text
scripts/quest-runner issues list --scope physicalplan
scripts/quest-runner issues list --scope polishing --slice 1
scripts/quest-runner issues respond <id> --scope polishing --slice 1 ...
```

These scopes encode current workflow concepts in CLI/API code and must be
removed.

## Proposed behavior

Commands identify the issue file directly:

```text
scripts/quest-runner issues list --file physicalplan_issues.md
scripts/quest-runner issues list --file slices/0001_foundation/polishing_issues.md
scripts/quest-runner issues read ISSUE-001 --file physicalplan_issues.md
scripts/quest-runner issues create --file physicalplan_issues.md --title ... --details ...
scripts/quest-runner issues edit ISSUE-001 --file physicalplan_issues.md --status completed
scripts/quest-runner issues respond ISSUE-001 --file slices/0001_foundation/polishing_issues.md --outcome Fixed --explanation ...
scripts/quest-runner issues responses ISSUE-001 --file slices/0001_foundation/polishing_issues.md
```

## Path rules

- `--file` is required for every issue command.
- `--file` is interpreted relative to the quest root.
- Absolute paths are rejected.
- Paths escaping the quest root with `..` are rejected.
- The target file must match a workflow-declared issue file. A declared path
  with no variables matches exactly. A declared path containing
  `$active_child` matches that file in **any** child directory of the
  collection (e.g. `$active_child/polishing_issues.md` matches
  `slices/0001_foundation/polishing_issues.md` and
  `slices/0002_api/polishing_issues.md`), regardless of which child is
  currently active. This preserves the current CLI's ability to address any
  slice via `--slice <n>`.
- The CLI may display friendly workflow aliases, but aliases are convenience UI;
  the command identity is the quest-relative file path.

## Issue entry format and owner role

The markdown format of issue files and issue-response files is unchanged.
Issue entries keep all current fields, including `owner_role`.

`owner_role` is attribution metadata only: it is written at creation and
displayed by the CLI, dashboard API, and web UI ("Owner: ..."). Nothing
enforces permissions from it — the reviewer-closes / responder-responds split
is prompt convention, and stays that way.

`owner_role` is currently derived from the hard-coded issue scope
(`physicalplan -> physical_plan_reviewer`, `polishing -> polisher_reviewer`).
With scopes removed, the value is determined as follows:

- `issues create` accepts an optional `--owner <name>` flag. When given, it is
  recorded verbatim as the new issue's `owner_role`.
- When omitted, the CLI uses the `owner` field of the matched workflow issue
  declaration (see `05_workflow_yaml_grammar.md`) as the default.

For the current workflow, prompts do not pass `--owner`, the declaration
defaults reproduce today's values, and issue files remain byte-identical.

Because `owner_role` is per-issue (not per-file), this already supports
multiple reviewer profiles filing issues into the **same** issue file: each
reviewer's prompt instructs it to pass `--owner <its-profile-name>`, and
issues in one file carry different owners. No runner or workflow-language
change is needed for that; it is purely a CLI calling convention.

## Response storage

Responses are stored in their own file with deterministic naming. They are not
stored in the issue file.

The workflow should not declare response files. Response storage is part of the
issue system and is derived from the issue file path.

The deterministic convention is:

- issue file ending in `_issues.md`
- response file at the same directory, replacing `_issues.md` with
  `_issue_responses.md`

Examples:

- issue file: `physicalplan_issues.md`
- response file: `physicalplan_issue_responses.md`

and:

- issue file: `slices/0001_foundation/polishing_issues.md`
- response file: `slices/0001_foundation/polishing_issue_responses.md`

The important requirements are that workflow config does not name response files,
responses are not embedded in issue files, and the runner does not know issue
types.

## Workflow integration

Workflow conditions reference issue files by path:

```yaml
has_open_issues:
  file: physicalplan_issues.md

no_open_issues:
  file: "$active_child/polishing_issues.md"
```

(Inside the slice machine, conditions simply use the machine-relative
`file: polishing_issues.md`; see path resolution in
`05_workflow_yaml_grammar.md`.)

Prompts should instruct agents to pass the issue file path explicitly.

## API changes

The REST API should mirror the CLI by accepting `issue_file` instead of `scope`
and `slice` fields, plus an optional `owner_role` on issue creation mirroring
`--owner`.

```json
{
  "project": "quest-runner",
  "quest_type": "main",
  "quest_number": 1,
  "issue_file": "physicalplan_issues.md",
  "owner_role": "polisher_reviewer"
}
```

Legacy `scope` and `slice` request fields should not remain as compatibility
paths in the runner.
