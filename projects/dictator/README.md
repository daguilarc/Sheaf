# Dictator

Dictator is the Sheaf project home for the migrated dictation service, core library,
prompts, and contracts.

## Build and test

From this directory:

- `make build` — compile the Swift package (`DictatorCore` + `DictatorService`)
- `make test-core` — run `DictatorCore` unit tests
- `make test` — run all migrated tests
- `make run` — start the `DictatorService` executable (endpoint wiring completes in slice 2)
- `make clean` — remove local SwiftPM build artifacts

## Layout

- `Package.swift` — Swift package root (sources under `src/`, tests under `tests/`)
- `src/Sources/` — `DictatorCore`, `CWhisper`, and `DictatorService` targets
- `src/prompts/` — refinement and system prompt catalogs
- `src/contracts/` — API contract source material
- `tests/` — `DictatorCoreTests`, `DictatorServiceTests`, and fixtures
- `quests/` — migration quest artifacts
- `docs/` — current-state documentation

See [docs/README.md](docs/README.md) for the project documentation index.
