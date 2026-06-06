# Repo Layout

Sheaf is intended to be a command hub containing many projects under one repository root.

## Top-Level Directories

- `projects/`: future home for every managed project. Each project gets one subdirectory.
- `config/`: shared and project-specific JSON configuration.
- `logs/`: runtime logs, grouped by project.
- `data/`: runtime data, grouped by project.
- `structure/`: repository layout, rules, and shared vocabulary.

The repository currently also contains pre-existing top-level directories that have not been migrated:

- `apps/`: existing application code.
- `docs/`: existing documentation for the current repo state.
- `quests/`: existing quest records.
- `prompts/`: existing prompt assets.

Do not move existing code into `projects/` unless a migration task explicitly requires it.

## Project Directory Shape

Every project under `projects/` should use this layout:

```text
projects/<project>/
  README.md
  quests/
  src/
  tests/
  docs/
```

- `README.md` gives the short project overview and links into `docs/`.
- `quests/` contains planned or active work for that project. See [Project Rules](project-rules.md).
- `src/` contains implementation code.
- `tests/` contains automated tests and test fixtures.
- `docs/` describes the current state of the project. See [Docs Structure](docs-structure.md).

Shared repo conventions are defined once in `structure/` and linked from project docs instead of being repeated.
