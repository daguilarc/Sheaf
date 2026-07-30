## MODIFIED Requirements

### Requirement: dpr-5 — Placeholders: substitute and validate required inputs
THE utility SHALL substitute supplied values for the selected template's placeholders, and SHALL exit non-zero when any placeholder that template marks REQUIRED is unsatisfied. THE utility SHALL treat every slot that declares no fallback as required, whether or not it is separately marked REQUIRED, since an absent value cannot be substituted; a slot's fallback is therefore the sole marker of genuine optionality. THE utility SHALL declare, for each slot, the direction it applies to the supplied path — an existing file the dispatched agent READS, a destination the agent WRITES that need not yet exist, or a file whose contents are inlined into the prompt — and SHALL enforce existence for read and inlined slots only. These declarations are the authority any embedder describes its own surface from; the utility SHALL keep its `--help` text consistent with them.

#### Scenario: Missing required placeholder is rejected
- **WHEN** a required placeholder for the selected template has no supplied value
- **THEN** the utility exits non-zero
- **AND** the error names the unsatisfied placeholder

#### Scenario: No residual required placeholder tokens
- **WHEN** rendering succeeds
- **THEN** the output contains no unsubstituted token for any required placeholder

#### Scenario: A slot without a fallback is required
- **WHEN** a slot declaring no fallback receives neither an explicit value nor a workspace derivation
- **THEN** the utility exits non-zero naming that option as required for the selected template

#### Scenario: Write-direction slots accept a path that does not exist
- **WHEN** a slot declared as a write destination names a file that does not yet exist
- **THEN** the utility substitutes the path and renders successfully

#### Scenario: Read-direction slots require existence
- **WHEN** a slot declared as a read input or an inlined file names a path that does not exist
- **THEN** the utility exits non-zero naming that option and the missing path

## ADDED Requirements

### Requirement: dpr-10 — Argument errors: stable single-line grammar, no body text
WHEN THE utility rejects an invocation because an option is missing, unaccepted by the selected template, or names a path that does not exist, THE utility SHALL emit exactly one diagnostic line of the form `dispatch-prompt: <option>: <reason>` or `dispatch-prompt: <option> <reason-clause>`, naming the option and, where the fault is a path, the caller-supplied path — and SHALL NOT include template, plan, brief, findings, or constraints file contents in that line. THE grammar SHALL be stable enough for an embedder to classify an argument fault by option name without parsing prose, so that a caller behind a facade can be told which flag was wrong.

An embedder that suppresses this stream wholesale, to avoid leaking inlined body text, otherwise discards the option name with it — leaving the caller a bare exit status and no way to learn which of its own arguments was at fault.

#### Scenario: A missing path names its option and path
- **WHEN** an option names a file that does not exist
- **THEN** the diagnostic line names that option and that path
- **AND** contains no file contents

#### Scenario: An unaccepted option names the template
- **WHEN** an option is supplied that the selected template declares no slot for
- **THEN** the diagnostic line names the option and the template that rejected it

#### Scenario: Inlined file contents never appear in a diagnostic
- **WHEN** an invocation fails while a constraints or findings file is being inlined
- **THEN** the diagnostic line contains no substring of that file's contents

#### Scenario: One line per rejection
- **WHEN** an invocation is rejected for an argument fault
- **THEN** exactly one diagnostic line is emitted
- **AND** the utility exits non-zero
