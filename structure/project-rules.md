# Project Rules

These rules apply to every project in `projects/`.

## Required Files And Directories

Each project must include:

- `README.md`
- `quests/`
- `src/`
- `tests/`
- `docs/`

The `README.md` should be a concise entry point. Detailed current-state documentation belongs in `docs/`.

## Quests Versus Docs

Docs are the **living spec**: a normative description of the project's
current behavior, held to the rebuild-test standard in
[Docs Structure](docs-structure.md). Quests are **delta specs**: descriptions
of changes to be made against that living spec.

- Put planned work, specs for future work, task state, and execution records in `quests/`.
- Put requirements, contracts, architecture, and operational procedures in `docs/`.
- Completing a quest means merging its delta into the living spec: the
  documenter updates the affected capability files, contracts, and
  `docs/coverage.md` as the final quest phase.

## Configuration

Projects must read configuration from `config/`. They must not rely on environment variables or local ad hoc config files.

See [Configuration](configuration.md) for the required files and lookup rules.

## Logs And Data

Projects must write logs under `logs/<project>/` and runtime data under `data/<project>/`.

See [Logs And Data](logs-and-data.md).

## Testing

Projects must keep regular tests separate from opt-in integration tests.

- The `test` target runs regular tests only.
- Integration tests live under `tests/integration/` when present.
- Integration tests run through an `integration-test` target and must not be
  included in default `test` or `all` workflows.

See [Testing](testing.md).

## Services

Only projects that need a long-running process need a service entry. Services are registered in `config/services.json` and should expose the standard lifecycle endpoints.

See [Services](services.md).
