# Docs Structure

Project docs are a **living spec**: a normative description of the project's
current behavior, detailed enough that — in principle — a fresh agent given
only `docs/` and `tests/` could reimplement the project and pass its tests.
This is the **rebuild test**. It is a quality bar, not a regular practice: we
do not routinely regenerate code, but every doc is written as if someone
might.

Docs describe the current state only. They are not a backlog, changelog, or
quest history. Planned work belongs in quests ([Project Rules](project-rules.md)):
quest `specs/` are *delta specs* against the living spec, and completing a
quest means merging that delta into the docs.

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

Each project keeps its living spec in `projects/<project>/docs/`:

```text
projects/<project>/docs/
  README.md                  # index: one-paragraph purpose + capability map table
  architecture.md            # cross-capability design: components, data flow, key decisions
  operations.md              # normative build/run/test/deploy procedures
  coverage.md                # rebuild-test audit: per-capability status + known gaps
  capabilities/
    <capability-slug>.md     # one file per capability: requirements + contracts + design
  contracts/                 # ONLY for schemas shared by two or more capabilities
    api.md  cli.md  config.md  data.md   # create as needed, not by default
```

A **capability** is a coherent externally visible behavior of the project
(e.g. `dashboard`, `issue-cli`, `session-lifecycle`) — the unit a reader would
want specified in one place. Prefer fewer, larger capabilities over many tiny
ones. A small project can be a single capability file plus `README.md`.

If a capability file grows past roughly 400 lines, it may be split into a
`capabilities/<capability>/` directory with `spec.md` as the entry point.
This is an escape hatch, not the default.

`operations.md` is normative, not tutorial: exact commands to build, run, and
execute every test lane, plus any environment setup those commands assume.
It alone must suffice to get from a fresh checkout to a running, tested
project.

## Capability File Template

```markdown
# Capability: Dashboard

ID prefix: `dash`

## Purpose

One paragraph: what this capability does and for whom.

## Requirements

- **[dash-1]** THE service SHALL serve the dashboard at `GET /dashboard`.
- **[dash-2]** WHEN a quest directory is missing `state.md`, THE dashboard
  SHALL render the quest as `unknown` rather than failing the page.
- **[dash-3]** WHILE a quest is running, THE dashboard SHALL poll
  `/api/quests` every 5 seconds.
- **[dash-4]** IF the service registry is unreachable, THEN THE dashboard
  SHALL show a degraded banner and continue rendering local state.

## Contracts

Endpoint, CLI, config, and file-format shapes owned by this capability,
inline. Link to `../contracts/*.md` only for schemas shared across
capabilities.

## Design

How it is implemented: key modules with repo paths, algorithms, invariants,
and rationale for non-obvious choices. Prose, not requirements.

## Interactions

Links to other capabilities this one depends on or feeds.
```

## Requirement Rules (EARS)

Requirements use [EARS](https://alistairmavin.com/ears/) forms, kept minimal:

- `THE <system> SHALL <behavior>` — always true (ubiquitous)
- `WHEN <event>, THE <system> SHALL <behavior>` — event-driven
- `WHILE <state>, THE <system> SHALL <behavior>` — state-driven
- `WHERE <feature is enabled>, THE <system> SHALL <behavior>` — optional feature
- `IF <unwanted condition>, THEN THE <system> SHALL <behavior>` — error handling

ID rules:

- IDs are `<prefix>-<n>`; the prefix is declared once at the top of the
  capability file.
- IDs are **append-only**: never renumber, never reuse. A removed requirement
  stays in place as `- **[dash-2]** RETIRED (quest main/0003).`
- Quest delta specs may reference IDs ("modifies `dash-3`, adds `dash-7`")
  but are not required to.

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

`docs/coverage.md` is the honest gap register, updated by the documenter at
the end of every quest:

```markdown
# Spec Coverage

Last audit: quest main/0007, 2026-06-09

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
3. Map changes to capabilities: update existing capability files, create new
   ones for genuinely new capabilities, retire dead requirements with
   `RETIRED` markers. Never renumber IDs.
4. Update `architecture.md`, `operations.md`, `contracts/`, and the
   `README.md` capability map when they are affected.
5. Run the rebuild-test checklist over every capability touched and update
   `coverage.md`.
6. Prefer updating existing canonical docs over creating overlapping new
   ones.
7. Include code pointers (files, symbols, commands, tests) in Design
   sections.
8. Do not directly modify quests.

## Linking Rules

Prefer links over repeated explanations.

- Link to [Configuration](configuration.md) instead of restating config rules.
- Link to [Services](services.md) instead of repeating service endpoint rules.
- Link to [Logs And Data](logs-and-data.md) instead of duplicating runtime path rules.
- Link to [Testing](testing.md) instead of restating test lane rules.
- Link to [Glossary](glossary.md) when using shared terms.

A schema used by a single capability lives inline in that capability file. A
schema shared by two or more capabilities lives in one canonical
`contracts/*.md` file, and capability files link to it.

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
