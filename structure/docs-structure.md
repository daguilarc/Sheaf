# Docs Structure

Project docs are a **living spec**: a normative description of the project's
current behavior, detailed enough that — in principle — a fresh agent given
the specs, `docs/`, and `tests/` could reimplement the project and pass its
tests. This is the **rebuild test**. It is a quality bar, not a regular
practice: we do not routinely regenerate code, but every doc is written as if
someone might.

Capability specs live in [OpenSpec](../openspec/) at
`openspec/specs/<project>-<capability>/spec.md`; the rest of the living spec
(architecture, operations, coverage, shared contracts) stays in each
project's `docs/`.

Docs describe the current state only. They are not a backlog, changelog, or
change history. Planned work belongs in OpenSpec changes
(`openspec/changes/<change-id>/`): a change's `specs/` are *delta specs*
(`## ADDED/MODIFIED/REMOVED Requirements`) against the main specs, and
archiving a change merges that delta into `openspec/specs/`. (Quest
directories under `quests/` are historical artifacts of the previous
workflow; do not modify them.)

## Repository-Level Docs

Use `structure/` for repository-wide rules and shared vocabulary:

- layout rules
- project rules
- configuration rules
- service rules
- web UI rules
- logging and data rules
- glossary terms

The root `README.md` should stay short and point readers to `structure/`.

## Project Docs Layout

Capability specs live at the repo root under `openspec/specs/`; everything
else stays in `projects/<project>/docs/`:

```text
openspec/specs/
  <project>-<capability>/
    spec.md                  # one spec per capability: requirements + contracts + design

projects/<project>/docs/
  README.md                  # index: one-paragraph purpose + capability map table
  architecture.md            # cross-capability design: components, data flow, key decisions
  operations.md              # normative build/run/test/deploy procedures
  coverage.md                # rebuild-test audit: per-capability status + known gaps
  contracts/                 # ONLY for schemas shared by two or more capabilities
    api.md  cli.md  config.md  data.md   # create as needed, not by default
```

Spec directories are named `<project>-<capability>` because OpenSpec
discovers specs one level deep (e.g. `sheaf-chat-chat-ui`,
`quest-runner-state-machine-engine`; exception: the web project's single
capability is `web-utilities`).

A **capability** is a coherent externally visible behavior of the project
(e.g. `dashboard`, `issue-cli`, `session-lifecycle`) — the unit a reader would
want specified in one place. Prefer fewer, larger capabilities over many tiny
ones. A small project can be a single capability spec plus `README.md`.

`operations.md` is normative, not tutorial: exact commands to build, run, and
execute every test lane, plus any environment setup those commands assume.
It alone must suffice to get from a fresh checkout to a running, tested
project.

## Capability Spec Template

Specs follow the OpenSpec format, validated by `openspec validate --specs
--strict`: each requirement is a `### Requirement:` block whose first body
line carries the SHALL/MUST clause, followed by at least one
`#### Scenario:` with WHEN/THEN bullets.

```markdown
# Capability: Dashboard

Project: `projects/quest-runner`
ID prefix: `dash` — requirement IDs are append-only; never renumber or reuse.

## Purpose

One paragraph: what this capability does and for whom.

## Requirements

### Requirement: dash-1 — Dashboard endpoint
THE service SHALL serve the dashboard at `GET /dashboard`.

#### Scenario: Dashboard requested
- **WHEN** `GET /dashboard` is requested
- **THEN** the dashboard page is served

### Requirement: dash-2 — Missing state rendering
WHEN a quest directory is missing `state.md`, THE dashboard SHALL render the quest as `unknown` rather than failing the page.

#### Scenario: Quest directory missing state.md
- **WHEN** a quest directory has no `state.md`
- **THEN** the dashboard renders that quest as `unknown` and the page still loads

## Contracts

Endpoint, CLI, config, and file-format shapes owned by this capability,
inline. Link to the project's `docs/contracts/*.md` only for schemas shared
across capabilities.

## Design

How it is implemented: key modules with repo paths, algorithms, invariants,
and rationale for non-obvious choices. Prose, not requirements.

## Interactions

Links to other capability specs this one depends on or feeds
(`../<project>-<capability>/spec.md`).
```

Two format constraints worth knowing: the OpenSpec parser treats **every**
`###` header inside `## Requirements` as a requirement, so grouping headers
are not allowed there — fold the group into the requirement name
(`### Requirement: dash-4 — Errors: registry unreachable`). And all
requirement blocks must precede the other `##` sections (Contracts, Design,
Interactions), which are preserved but not validated.

## Requirement Rules (EARS)

Requirements use [EARS](https://alistairmavin.com/ears/) forms, kept minimal:

- `THE <system> SHALL <behavior>` — always true (ubiquitous)
- `WHEN <event>, THE <system> SHALL <behavior>` — event-driven
- `WHILE <state>, THE <system> SHALL <behavior>` — state-driven
- `WHERE <feature is enabled>, THE <system> SHALL <behavior>` — optional feature
- `IF <unwanted condition>, THEN THE <system> SHALL <behavior>` — error handling

ID rules:

- IDs are `<prefix>-<n>`; the prefix is declared once at the top of the
  capability spec. Requirement headers are `### Requirement: <id> — <name>`.
- IDs are **append-only**: never renumber, never reuse. A removed requirement
  moves to a `## Retired Requirements` section at the end of the spec as
  `- **dash-2** — RETIRED (<change-id>).` (it cannot stay as a
  `### Requirement:` block, which would require SHALL text and a scenario).
- OpenSpec change deltas target requirements by their full header name, so
  the `<id> — <name>` header is the stable key; rename only via a
  `## RENAMED Requirements` delta.

**Anti-ceremony rule:** a requirement earns an ID only if it is *externally
observable* — API behavior, CLI behavior, UI behavior, file or wire format,
failure behavior. How the code is internally organized is Design prose, not a
requirement; the rebuild test demands behavioral equivalence, not identical
code.

**Design is non-normative.** Any behavior that must survive a rebuild belongs
in Requirements or Contracts, even when it reads like an implementation note
(locking visible through the API, discovery/matching rules, atomicity). If
deleting the Design section would lose behavior the tests assert, the spec is
mis-filed.

**Contracts prefer worked examples and exact strings.** Real request/response
bodies, CLI transcripts, and file snippets carry more rebuild value than prose.
When tests pin error wording, quote the exact message (or pinned substring) in
an error catalogue: condition → status/exit code → message.

## The Rebuild Test

The living spec passes the rebuild test when:

1. Every externally observable behavior (endpoint, CLI command, UI surface,
   file written, event emitted) has a requirement with an ID.
2. Every contract is fully shaped: request/response bodies, CLI flags and
   outputs, config keys with defaults, file/data formats with field meanings.
3. Error and edge behavior is specified: invalid input, missing files,
   restart/recovery, concurrent access where relevant.
4. Persistent state formats are specified well enough to write a compatible
   reader and writer.
5. Cross-capability interactions are named and linked, not implied.
6. `operations.md` alone suffices to build, run, and execute the test suites.
7. Everything intentionally unspecified is listed in `coverage.md` —
   **silence is a defect; a listed gap is not.**

## Coverage File

`docs/coverage.md` is the honest gap register, updated whenever a change
lands against the project's specs:

```markdown
# Spec Coverage

Last audit: change add-dashboard-filters, 2026-06-09

| Capability | Status | Gaps |
|---|---|---|
| dashboard | full | — |
| chat-ui | partial | reconnect behavior unspecified (see below) |

## Known gaps

- chat-ui: reconnect/backoff behavior implemented in `src/...` but not
  specified.
```

`Status` is `full` (passes the rebuild-test checklist) or `partial` (gaps
listed). A capability with unlisted gaps is a documentation defect.

## Default Agent Behavior

When documenting without more specific instructions, an agent should:

1. Read this file, the project's `docs/README.md`, and the relevant source,
   tests, and config before writing.
2. Document current behavior only, in present tense. The code is the source
   of truth; existing docs are leads, not authority.
3. Map changes to capabilities: update existing specs under
   `openspec/specs/<project>-<capability>/spec.md`, create new spec dirs for
   genuinely new capabilities, retire dead requirements into
   `## Retired Requirements`. Never renumber IDs. Validate with
   `openspec validate --specs --strict`.
4. Update `architecture.md`, `operations.md`, `contracts/`, and the
   `README.md` capability map when they are affected.
5. Run the rebuild-test checklist over every capability touched and update
   `coverage.md`.
6. Prefer updating existing canonical docs over creating overlapping new
   ones.
7. Include code pointers (files, symbols, commands, tests) in Design
   sections.
8. Do not directly modify quest directories (historical) or in-flight
   OpenSpec change directories that belong to other work.

## Linking Rules

Prefer links over repeated explanations.

- Link to [Configuration](configuration.md) instead of restating config rules.
- Link to [Services](services.md) instead of repeating service endpoint rules.
- Link to [Logs And Data](logs-and-data.md) instead of duplicating runtime path rules.
- Link to [Testing](testing.md) instead of restating test lane rules.
- Link to [Glossary](glossary.md) when using shared terms.

A schema used by a single capability lives inline in that capability spec. A
schema shared by two or more capabilities lives in one canonical
`projects/<project>/docs/contracts/*.md` file, and capability specs link to
it.

## Duplication And Hierarchy

Avoid duplication. If the same fact appears in multiple places, choose one
canonical home and link to it from the others.

Docs should be as path-independent as practical:

- Each document should state its scope clearly.
- Each document should link to prerequisites, canonical references, and
  related docs.
- A reader landing directly on a document should be able to understand what
  it covers and where to go next.
- Avoid wording that assumes the reader has read a previous page unless that
  dependency is explicitly linked.

Use relative links inside docs so the documentation remains portable when a
project moves within the repo.
