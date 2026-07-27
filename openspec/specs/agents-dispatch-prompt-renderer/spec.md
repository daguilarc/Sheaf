# Capability: Agents Dispatch Prompt Renderer

Project: `projects/agents`
ID prefix: `dpr` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Renders Superpowers subagent prompt templates into files with substituted
placeholders, so a controller dispatches a subagent by handing it a path
instead of re-emitting template prose from its own context.

## Requirements

### Requirement: dpr-1 — Utility: location and invocation contract
WHEN a controller renders a dispatch prompt, THE repository SHALL provide an executable at `projects/agents/utils/dispatch-prompt` invoked as `dispatch-prompt <template> <args...> [--constraints FILE]`, which on success writes the rendered prompt to a file, prints only that file's absolute path on stdout, and exits zero.

#### Scenario: Successful render prints one path
- **WHEN** the utility is invoked with a supported template and all required arguments
- **THEN** it writes the rendered prompt to a file
- **AND** stdout contains exactly the absolute path of that file
- **AND** the exit status is zero

#### Scenario: Failure writes no output file
- **WHEN** the utility exits non-zero for any reason
- **THEN** no rendered prompt file is created or overwritten
- **AND** the error message names the specific missing input or unresolved path

### Requirement: dpr-2 — Templates: four supported role names
THE utility SHALL accept exactly the template names `implementer`, `task-reviewer`, `re-review`, and `code-reviewer`, mapping them to the corresponding Superpowers template files, and SHALL reject any other name.

#### Scenario: Each supported name resolves
- **WHEN** the utility is invoked with `implementer`, `task-reviewer`, `re-review`, or `code-reviewer`
- **THEN** it resolves the corresponding Superpowers template file

#### Scenario: Unknown template name is rejected
- **WHEN** the utility is invoked with a template name outside the supported set
- **THEN** it exits non-zero
- **AND** the error lists the four supported names

### Requirement: dpr-3 — Template source: resolve installed Superpowers tree
THE utility SHALL resolve template files from the installed Superpowers plugin skills tree, selecting the highest installed version when several are present, and SHALL accept an explicit override of the templates root for pinning or testing.

#### Scenario: Highest installed version is selected
- **WHEN** several Superpowers versions are installed side by side
- **THEN** the utility reads templates from the highest version

#### Scenario: Explicit override wins
- **WHEN** an explicit templates root is supplied
- **THEN** the utility reads templates from that root and does not consult the installed versions

#### Scenario: Unresolvable template source fails loudly
- **WHEN** no Superpowers template tree can be resolved
- **THEN** the utility exits non-zero
- **AND** the error names the paths it searched

### Requirement: dpr-4 — Rendering: emit the prompt body only
THE utility SHALL emit only the prompt body carried by the template's dispatch block, with its indentation removed, and SHALL exclude the template's title, its dispatch scaffold lines, its placeholder documentation, and its return-contract note.

#### Scenario: Wrapper material is excluded
- **WHEN** a template is rendered
- **THEN** the output omits the template title heading, the `Subagent`/`description`/`model` scaffold lines, the `**Placeholders:**` list, and the trailing returns note
- **AND** the output begins with the first line of the prompt body

#### Scenario: Body text is preserved verbatim
- **WHEN** a template is rendered with every placeholder satisfied
- **THEN** every non-placeholder line of the prompt body appears in the output unmodified apart from dedenting

### Requirement: dpr-5 — Placeholders: substitute and validate required inputs
THE utility SHALL substitute supplied values for the selected template's placeholders, and SHALL exit non-zero when any placeholder that template marks REQUIRED is unsatisfied.

#### Scenario: Missing required placeholder is rejected
- **WHEN** a required placeholder for the selected template has no supplied value
- **THEN** the utility exits non-zero
- **AND** the error names the unsatisfied placeholder

#### Scenario: No residual required placeholder tokens
- **WHEN** rendering succeeds
- **THEN** the output contains no unsubstituted token for any required placeholder

### Requirement: dpr-6 — Constraints: default to the plan workspace file
WHERE the selected template carries a global-constraints placeholder, THE utility SHALL default the constraints source to `global-constraints.md` in the plan's SDD workspace when that file exists, SHALL prefer an explicitly supplied constraints file over the default, and SHALL reject an explicit constraints file for a template that carries no such placeholder.

#### Scenario: Workspace default is used
- **WHEN** the template carries a global-constraints placeholder, no constraints file is supplied, and the plan workspace contains `global-constraints.md`
- **THEN** the utility substitutes that file's contents

#### Scenario: Explicit file overrides the default
- **WHEN** a constraints file is supplied explicitly
- **THEN** the utility substitutes that file's contents regardless of the workspace default

#### Scenario: Constraints rejected for templates without the placeholder
- **WHEN** a constraints file is supplied for a template that carries no global-constraints placeholder
- **THEN** the utility exits non-zero
- **AND** the error names the template and the rejected option

### Requirement: dpr-7 — Output files: per-plan workspace, role-distinct names
THE utility SHALL write rendered prompts into the plan's SDD workspace under names that distinguish template role, task, and fix round, so that concurrent renders never overwrite one another and an implementer's dispatch file is not the same file as its reviewer's.

#### Scenario: Reviewer and implementer renders are distinct files
- **WHEN** an implementer prompt and a task-reviewer prompt are rendered for the same task
- **THEN** the utility writes two files at different paths

#### Scenario: Re-review rounds do not clobber
- **WHEN** re-review prompts are rendered for successive fix rounds of one task
- **THEN** each round is written to its own path

### Requirement: dpr-8 — Template drift: fail when a declared placeholder is absent
THE utility SHALL verify that every placeholder it declares for the selected template is present in the resolved template file, and SHALL exit non-zero when any declared placeholder is absent, so that an upstream template revision cannot silently drop substituted content.

#### Scenario: Drifted template is rejected
- **WHEN** a declared placeholder for the selected template is absent from the resolved template file
- **THEN** the utility exits non-zero
- **AND** the error names the template, the resolved source, and the absent placeholder

#### Scenario: Matching template renders
- **WHEN** every declared placeholder is present in the resolved template file
- **THEN** the utility renders without a drift error

### Requirement: dpr-9 — Brief: explicitly supplied, existing, referenced by path
WHERE the selected template carries a task-brief placeholder, THE utility SHALL require the brief to be supplied explicitly as a file path rather than deriving or accepting inline text, SHALL exit non-zero when that path is absent, missing on disk, or empty, and SHALL substitute the path itself into the rendered prompt so the subagent reads the brief from disk.

#### Scenario: Missing brief option is rejected
- **WHEN** a template carrying a task-brief placeholder is rendered without an explicit brief path
- **THEN** the utility exits non-zero
- **AND** the error states that the brief must be supplied as a file path

#### Scenario: Nonexistent or empty brief file is rejected
- **WHEN** the supplied brief path does not exist, or exists and is empty
- **THEN** the utility exits non-zero
- **AND** the error names the offending path

#### Scenario: Brief is substituted as a path, not as content
- **WHEN** rendering succeeds for a template carrying a task-brief placeholder
- **THEN** the rendered prompt contains the brief file's path
- **AND** the rendered prompt does not contain the brief file's body text
