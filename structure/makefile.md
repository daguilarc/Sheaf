# Makefiles

This repository uses a two-level Makefile layout:

- one top-level `Makefile` at the repository root
- one `Makefile` inside each managed project under `projects/<project>/`

The root Makefile orchestrates work across projects. Project Makefiles own the
commands for that project's toolchain.

## Why Make Here

Sheaf is a command hub for multiple projects. Make gives one stable entry point for
common workflows such as build, test, run, and clean without requiring contributors
to remember each project's npm, shell, or future toolchain details.

See [Testing](testing.md) for the distinction between regular tests,
integration tests, smoke tests, and manual checks.

## Command Syntax

GNU Make treats spaces as separators between independent targets.

Use hyphenated project targets:

```bash
make conductor-build
make conductor-run
make conductor-clean
```

Or invoke a project Makefile directly:

```bash
make -C projects/conductor build
```

## Root Makefile

Path:

```text
Makefile
```

Responsibilities:

- maintain the `PROJECTS` list of managed projects
- expose aggregate targets across every listed project
- forward per-project shortcuts to `projects/<project>/Makefile`

### Aggregate Targets

| Target | Meaning |
|---|---|
| `all` | Default target. Runs each project's `all` target. |
| `test` | Runs each project's `test` target. |
| `integration-test` | Runs each project's opt-in `integration-test` target. |
| `clean` | Runs each project's `clean` target. |
| `help` | Prints the supported root commands. |

Examples:

```bash
make
make all
make test
make integration-test
make clean
```

### Project Shortcuts

For each project listed in `PROJECTS`, the root Makefile exposes:

| Target pattern | Delegates to |
|---|---|
| `make <project>` | `projects/<project>/all` |
| `make <project>-build` | `projects/<project>/build` |
| `make <project>-test` | `projects/<project>/test` |
| `make <project>-integration-test` | `projects/<project>/integration-test` |
| `make <project>-run` | `projects/<project>/run` when defined |
| `make <project>-clean` | `projects/<project>/clean` |

Current projects:

- `conductor`
- `web`
- `quest-runner`
- `dictator`
- `realtime-agent`
- `sheaf-chat`

Examples:

```bash
make conductor
make conductor-build
make conductor-test
make conductor-integration-test
make conductor-run
make conductor-clean

make web
make web-build
make web-test
make web-clean
```

### Adding A New Project

1. Create `projects/<project>/Makefile`.
2. Add `<project>` to the `PROJECTS` variable in the root `Makefile`.
3. Add root forwarding targets for suffixed commands such as `myproject-build`,
   `myproject-test`, `myproject-integration-test`, `myproject-run`, and
   `myproject-clean` when needed. The bare `make myproject` target is provided
   automatically by the root `$(PROJECTS)` pattern rule.
4. Document any project-specific behavior in that project's `README.md`.

## Project Makefiles

Path:

```text
projects/<project>/Makefile
```

Each project should expose a small, predictable interface.

### Standard Targets

| Target | Typical meaning |
|---|---|
| `all` | Default project workflow. Usually build and test. |
| `build` | Compile, bundle, or otherwise prepare runnable artifacts. |
| `test` | Run regular automated tests or validation. |
| `integration-test` | Run opt-in integration tests. |
| `clean` | Remove generated artifacts for that project. |
| `run` | Start a long-running service. Only for service projects. |

Not every project needs every target. Asset-only or library projects may omit `run`.

## Relationship To Services

Service projects should keep `run` aligned with the command registered in
`config/services.json`.

For Conductor, the registry command is:

```bash
make conductor-run
```

That root target delegates to `projects/conductor/run`, which wraps `start_conductor.sh`.

## Conventions

- Keep project-specific command logic in `projects/<project>/Makefile`.
- Keep the root `Makefile` thin: discovery, aggregation, and forwarding only.
- Prefer hyphenated root targets such as `conductor-build` over multi-word Make
  invocations.
- When a project gains a new common workflow, add a named target in that project's
  Makefile first, then expose a forwarded root target if it should be callable from
  the repository root.
- Keep `test` regular-only. Add `integration-test` for scripted integration
  coverage instead of adding slower boundary tests to default test runs.
