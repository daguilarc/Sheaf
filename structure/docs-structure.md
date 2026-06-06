# Docs Structure

Docs describe the current state of the repo or project. They should not be used as a backlog.

Use Diataxis as the default documentation model:

- Tutorials teach a new reader through a guided path.
- How-to guides solve concrete tasks.
- Reference docs state exact facts, APIs, commands, config, schemas, and contracts.
- Explanation docs describe architecture, concepts, rationale, and tradeoffs.

When an agent is asked to document something without more specific instructions, it should use this model unless the existing project docs clearly use another established pattern.

## Repository-Level Docs

Use `structure/` for repository-wide rules and shared vocabulary:

- layout rules
- project rules
- configuration rules
- service rules
- logging and data rules
- glossary terms

The root `README.md` should stay short and point readers to `structure/`.

## Project Docs

Each project should keep current-state documentation in:

```text
projects/<project>/docs/
```

Recommended project docs:

```text
projects/<project>/docs/
  README.md
  tutorials/
  how-to/
  reference/
  explanation/
```

- `README.md`: documentation index for the project.
- `tutorials/`: guided learning paths.
- `how-to/`: task-oriented guides.
- `reference/`: exact current-state specifications.
- `explanation/`: concepts, architecture, decisions, and rationale.

Common reference docs include:

```text
projects/<project>/docs/reference/
  api.md
  cli.md
  config.md
  data.md
  services.md
  testing.md
```

Common explanation docs include:

```text
projects/<project>/docs/explanation/
  architecture.md
  concepts.md
  decisions/
```

Only create docs that match the actual project. A small project can start with just `docs/README.md` and add hierarchy when the documentation needs it.

## Default Agent Behavior

When documenting without more specific instructions, an agent should:

1. Identify the project or repo surface being documented.
2. Read the relevant `README.md`, existing docs, source, tests, and config before writing.
3. Document the current state only.
4. Put content in the Diataxis category that matches the reader need.
5. Prefer updating existing canonical docs over creating overlapping new docs.
6. Include code pointers for implementation details, using stable links to files, symbols, commands, or tests where useful.
7. Keep docs clean and up-to-date as part of any change that affects documented behavior.
8. Do not directly modify quests.

## Linking Rules

Prefer links over repeated explanations.

- Link to [Configuration](configuration.md) instead of restating config rules.
- Link to [Services](services.md) instead of repeating service endpoint rules.
- Link to [Logs And Data](logs-and-data.md) instead of duplicating runtime path rules.
- Link to [Glossary](glossary.md) when using shared terms.

API specifications should live in one canonical reference document per project, usually `projects/<project>/docs/reference/api.md`, and other docs should link to that file.

## Duplication And Hierarchy

Avoid duplication. If the same fact appears in multiple places, choose one canonical home and link to it from the others.

Make documentation hierarchical when the project is complex enough to benefit from it. Hierarchy should help readers find the right level of detail; it should not force readers through a single path to understand the project.

Docs should be as path-independent as practical:

- Each document should state its scope clearly.
- Each document should link to prerequisites, canonical references, and related docs.
- A reader landing directly on a document should be able to understand what it covers and where to go next.
- Avoid wording that assumes the reader has read a previous page unless that dependency is explicitly linked.

Use relative links inside docs so the documentation remains portable when a project moves within the repo.
