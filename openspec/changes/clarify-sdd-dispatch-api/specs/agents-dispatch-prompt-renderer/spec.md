## MODIFIED Requirements

### Requirement: dpr-5 — Placeholders: substitute and validate required inputs
THE utility SHALL substitute supplied values for the selected template's placeholders, and SHALL exit non-zero when any placeholder that template marks REQUIRED is unsatisfied. THE utility SHALL additionally exit non-zero when any slot is unsatisfied by an explicit value, a derivation, and a fallback, because a surviving token in a delivered prompt is noise the subagent must interpret; a slot declaring no fallback is therefore unrenderable without a value, whether that value is supplied or derived.

WHERE a slot's value is a filesystem path the caller supplies, THE utility SHALL declare its **direction**: `reads` for a path whose file must already exist — whether the prompt receives the path itself or the file's contents — and `writes` for a destination the subagent creates, whose parent alone must exist. Direction SHALL be declared only for those artifact-bearing slots. Slots carrying inline text, an inline-or-`@FILE` value, or a plain literal SHALL carry no direction; `kind` remains the complete description of every slot. THE utility SHALL keep its `--help` text consistent with these declarations.

Direction is what an embedder cannot infer and repeatedly gets wrong: a caller who passes its own output path where an existing input was wanted gets a failure that names neither. Whether a `reads` slot substitutes the path or inlines the contents is a rendering choice, described but not a distinct direction.

#### Scenario: Missing required placeholder is rejected
- **WHEN** a required placeholder for the selected template has no supplied value
- **THEN** the utility exits non-zero
- **AND** the error names the unsatisfied placeholder

#### Scenario: No residual required placeholder tokens
- **WHEN** rendering succeeds
- **THEN** the output contains no unsubstituted token for any required placeholder

#### Scenario: A slot without a fallback is unrenderable unsatisfied
- **WHEN** a slot declaring no fallback receives neither an explicit value nor a workspace derivation
- **THEN** the utility exits non-zero naming that option as required for the selected template

#### Scenario: A derivation satisfies a fallback-less slot
- **WHEN** a slot declaring no fallback receives no explicit value but the plan workspace holds the file its documented derivation names
- **THEN** the utility renders successfully using the derived value

#### Scenario: Write-direction slots accept a path that does not exist
- **WHEN** a slot declared `writes` names a file that does not yet exist and whose parent directory does
- **THEN** the utility substitutes the path and renders successfully

#### Scenario: Read-direction slots require existence
- **WHEN** a slot declared `reads` names a path that does not exist or is empty
- **THEN** the utility exits non-zero naming that option and the path

#### Scenario: Non-path slots carry no direction
- **WHEN** a slot's kind is inline text, inline-or-`@FILE`, or a literal
- **THEN** it declares no direction
- **AND** its absence of a direction is not an error

## ADDED Requirements

### Requirement: dpr-10 — Argument faults: coded, machine-parseable, free of body text
WHEN THE utility rejects an invocation because a supplied option is missing, unaccepted by the selected template, or names a path that is absent, empty, or has no parent directory, THE utility SHALL emit as the **final line of stderr** a single-line JSON object carrying exactly the keys `error`, `option`, and — where the fault concerns a path or a template — `path` and `template`, and SHALL exit non-zero. Human-readable diagnostic lines MAY precede it.

THE `error` value SHALL be one of exactly: `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, `required_missing`.

THE JSON object SHALL carry no other keys, and in particular SHALL NOT carry template, plan, brief, findings, or constraints file **contents**. Because the emitted keys are enumerated and their values are the caller's own option name and path, no inlined body text can reach the stream through this line.

A structured trailer rather than parsed prose is deliberate: an embedder that suppresses this stream wholesale to avoid leaking inlined body text otherwise discards the option name with it, leaving the caller a bare exit status and no way to learn which of its own arguments was at fault. Prose is free to change; this line is a contract.

#### Scenario: A missing path emits its code, option, and path
- **WHEN** an option names a file that does not exist
- **THEN** the final stderr line parses as JSON with `error` of `no_such_file`, the option, and the path
- **AND** the utility exits non-zero

#### Scenario: An empty file is distinguished from a missing one
- **WHEN** an option names a file that exists but is empty
- **THEN** the final stderr line carries `error` of `empty_file`

#### Scenario: A write destination without a parent is distinguished
- **WHEN** a `writes` slot names a path whose parent directory does not exist
- **THEN** the final stderr line carries `error` of `parent_missing`

#### Scenario: An unaccepted option names the template
- **WHEN** an option is supplied that the selected template declares no slot for
- **THEN** the final stderr line carries `error` of `not_accepted`, the option, and the template

#### Scenario: An unsatisfiable slot is coded required
- **WHEN** a slot has no explicit value, no derivation, and no fallback
- **THEN** the final stderr line carries `error` of `required_missing`, the option, and the template

#### Scenario: Inlined file contents never appear in the trailer
- **WHEN** an invocation fails while a constraints or findings file is being read for inlining
- **THEN** the final stderr line contains no substring of that file's contents

#### Scenario: Non-argument failures emit no trailer
- **WHEN** the utility fails for a reason outside the enumerated argument faults — an unresolvable template tree, or template drift
- **THEN** no JSON trailer is emitted
- **AND** an embedder classifying by trailer treats the failure as unrecognized

### Requirement: dpr-11 — Slot table: a versioned machine-readable description of every template's contract
THE utility SHALL support a `--describe-slots` invocation that writes to stdout a single JSON document describing every supported template and exits zero without rendering, reading a plan, or requiring any other option.

THE version-1 document SHALL be an object carrying `schema_version` (integer, `1`) and `templates` (an object keyed by template name whose values are arrays of slot entries). Each slot entry SHALL carry exactly: `option`, `token`, `kind`, `direction` (`"reads"`, `"writes"`, or null), `has_fallback` (boolean), and `derivation`. `schema_version` SHALL increment whenever this shape changes.

THE `derivation` SHALL be a structured object rather than a bare filename, because the renderer's derivations are not all plan-workspace lookups, and SHALL be one of:

- `null` — no derivation.
- `{ "kind": "repo_root" }` — the value defaults to the repository root, as `--dir` does.
- `{ "kind": "plan_workspace", "pattern": "<template>", "requires_existing": <boolean> }` — the value defaults to a file in the plan's SDD workspace. THE `pattern` SHALL use `{task}` for the task number and `{short(base)}` / `{short(head)}` for abbreviated revisions, so a consumer reproduces the exact filename rather than guessing it: `task-{task}-report.md`, `global-constraints.md`, `review-{short(base)}..{short(head)}.diff`.

THE `short` function SHALL be defined exactly as: `git rev-parse --short <rev>` executed in the renderer's working directory, falling back to the first seven characters of the supplied revision string when that command fails. A consumer that implements a different abbreviation will search a different filename and wrongly conclude a derivation is unavailable.

This interface exists so an embedder can describe its own surface from the renderer's contract instead of restating it. An embedder that restates it is exactly the defect this change was raised to fix.

#### Scenario: The table is obtainable without a plan
- **WHEN** the utility is invoked with `--describe-slots` and no other option
- **THEN** it writes one JSON document to stdout and exits zero
- **AND** renders nothing and creates no workspace

#### Scenario: Every template and slot appears
- **WHEN** the document is parsed
- **THEN** it contains an entry for each supported template name
- **AND** each template's entry lists every slot that template declares

#### Scenario: Directions and derivations are machine-readable
- **WHEN** a consumer reads a slot entry for an artifact-bearing slot
- **THEN** the entry states its direction and whether a fallback exists
- **AND** states a structured derivation object, or null where none exists

#### Scenario: Every derivation the renderer performs is described
- **WHEN** the document is compared against the utility's own derivation logic
- **THEN** each slot the utility can satisfy without an explicit value carries a matching derivation entry, including the repository-root default and each plan-workspace pattern
- **AND** a slot the utility cannot derive carries null

#### Scenario: A consumer reproduces the diff filename exactly
- **WHEN** a consumer resolves the review-package derivation for a given base and head
- **THEN** it abbreviates both revisions with `git rev-parse --short`, falling back to the first seven characters on failure
- **AND** arrives at the same filename the utility would derive

#### Scenario: The shape is versioned
- **WHEN** the document's shape changes
- **THEN** `schema_version` increases
- **AND** a consumer pinned to an older version can detect the change rather than misread it
