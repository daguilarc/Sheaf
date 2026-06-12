# Capability: Agents Skill Distribution

Project: `projects/agents`
ID prefix: `asd` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Maintains shared agent instructions and skills from a canonical
`projects/agents` source tree, then installs them into the harness-specific
locations used by Claude Code, Cursor, Pi, and Codex. This capability owns the
source skill metadata format, global instruction rendering, managed generated
file safety, and Makefile entry points for installing and checking the generated
agent guidance.

## Requirements
### Requirement: asd-1 — Source tree: canonical agents project
WHEN the agents project is implemented, THE repository SHALL contain `projects/agents/` with `global/AGENTS.md` as the canonical global instruction source and `global/skills/` as the canonical shared skill source tree.

#### Scenario: Source tree exists
- **WHEN** a developer inspects the repository root
- **THEN** the `projects/agents/` directory exists
- **AND** `projects/agents/global/AGENTS.md` exists
- **AND** `projects/agents/global/skills/` exists

### Requirement: asd-2 — Skill sources: one directory per shared skill
WHEN a shared skill is added, THE agents project SHALL store it under `projects/agents/global/skills/<skill-id>/` with metadata and a source `SKILL.md` body sufficient to render the skill for every supported harness target.

#### Scenario: Shared skill source exists
- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** each shared skill is discoverable as one `projects/agents/global/skills/<skill-id>/` directory
- **AND** each shared skill includes metadata and source markdown

### Requirement: asd-3 — Initial skills: convert prompt drafts
WHEN the agents project is first implemented, THE repository SHALL include shared skills converted from the prompt drafts `about_me.me`, `git_workflow.md`, `incremental_mode.md`, `pyramid_index.md`, and `software_principles.md` found under `/Users/joyo/Desktop/prompt_draft`.

#### Scenario: Initial converted skills are present
- **WHEN** the installer scans the shared skill source tree
- **THEN** it finds source skills for `about-me`, `git-workflow`, `incremental-mode`, `pyramid-index`, and `software-principles`

### Requirement: asd-4 — Install script: harness-specific skill outputs
WHEN `projects/agents/scripts/install.py install` runs, THE installer SHALL render each shared skill into `.claude/skills/<skill-id>/SKILL.md`, `.cursor/skills/<skill-id>/SKILL.md`, `.pi/skills/<skill-id>/SKILL.md`, and `.codex/skills/<skill-id>/SKILL.md`.

#### Scenario: Skills installed
- **WHEN** the install command completes successfully
- **THEN** every shared skill has an installed `SKILL.md` file in the Claude Code, Cursor, Pi, and Codex skill directories

### Requirement: asd-5 — Install script: global instruction outputs
WHEN `projects/agents/scripts/install.py install` runs, THE installer SHALL render `projects/agents/global/AGENTS.md` to repository-root `AGENTS.md` and repository-root `CLAUDE.md`.

#### Scenario: Global instructions installed
- **WHEN** the install command completes successfully
- **THEN** root `AGENTS.md` exists with the rendered global instruction content
- **AND** root `CLAUDE.md` exists with the rendered global instruction content

### Requirement: asd-6 — Install script: managed-file safety
IF an install destination exists, differs from the rendered output, and is not marked as managed by the agents installer, THEN THE installer SHALL fail without overwriting it unless the user explicitly passes a force option.

#### Scenario: Unmarked conflict
- **WHEN** a destination file exists without the managed marker
- **AND** the destination content differs from the rendered content
- **THEN** installation fails before overwriting the file

### Requirement: asd-7 — Check mode: drift detection
WHEN `projects/agents/scripts/install.py check` runs, THE installer SHALL compare the rendered outputs with installed files and exit non-zero if any managed output is missing or stale.

#### Scenario: Installed output is stale
- **WHEN** an installed skill file differs from the rendered source
- **THEN** check mode exits non-zero and reports the stale path

### Requirement: asd-8 — Clean mode: managed output removal
WHEN `projects/agents/scripts/install.py clean` runs, THE installer SHALL remove only files and directories it can identify as managed agents-installer outputs.

#### Scenario: Unmanaged file exists
- **WHEN** clean mode encounters an unmarked file in a harness skill directory
- **THEN** it leaves the unmarked file unchanged

### Requirement: asd-9 — Makefile: delegated agents targets
WHEN the agents project is implemented, THE root Makefile SHALL expose delegated `agents`, `agents-install`, `agents-check`, and `agents-clean` targets that call the matching targets in `projects/agents/Makefile`.

#### Scenario: Agent install target invoked
- **WHEN** a developer runs `make agents-install`
- **THEN** make delegates to `projects/agents/Makefile`
- **AND** the agents installer runs in install mode
