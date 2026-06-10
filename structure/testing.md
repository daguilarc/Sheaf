# Testing

This repository separates regular tests from integration tests.

Regular tests are the default validation path. Integration tests are first-class
automated tests, but they are opt-in and must not run as part of normal test
targets.

## Test Lanes

### Regular Tests

Regular tests run through:

```bash
make test
make <project>-test
make -C projects/<project> test
```

They should be fast, deterministic, and suitable for frequent local runs. They
may use fakes, mocks, temp directories, in-memory state, and small local
fixtures.

Regular tests must not require:

- externally running services
- paid or network API access
- credentials
- hardware devices
- slow multi-process orchestration
- machine-specific setup beyond the project's documented development toolchain

The root `test` target delegates only to each project's regular `test` target.

### Integration Tests

Integration tests run through:

```bash
make integration-test
make <project>-integration-test
make -C projects/<project> integration-test
```

Integration tests exercise meaningful boundaries between separately useful parts
of a project or between projects. Examples include:

- an HTTP API through a real local server
- websocket behavior through a real local server
- a CLI talking to a local service
- persistence through the public repository or service API
- filesystem or git workflows using temp checkouts
- browser UI behavior against a local development server
- multi-process workflows where process boundaries are the behavior under test

Integration tests may be less deterministic than regular tests. They may start
and stop their own local services, create temp data, depend on timing or process
boundaries, and run slower than regular tests.

Integration tests must not use production data, production directories, or
production services. Use test fixtures, temp directories, local test services, or
explicitly documented non-production environments.

Integration tests must not be included in `make test`, project `test` targets,
or default `all` workflows unless a project has explicitly documented an
exception.

### Manual And External Smoke Tests

Tests that require real external systems are not normal integration tests.

Use a separate project-specific target such as `smoke-test` or `manual-test` for
checks that require:

- real paid APIs
- real credentials
- internet access
- microphones, cameras, keyboards, phones, or other hardware
- local applications outside the project toolchain
- long-running human-observed sessions

These checks should document their prerequisites and expected side effects in
the project docs.

## Directory Layout

Put regular tests under the project's existing `tests/` tree.

Put integration tests under:

```text
projects/<project>/tests/integration/
```

Use project-specific subdirectories below `tests/integration/` when helpful.

Projects with toolchain constraints may use equivalent test target names or
framework-native groupings, but the project Makefile must still expose
`integration-test` as the stable command.

## Makefile Contract

Project Makefiles should expose:

| Target | Meaning |
|---|---|
| `test` | Run regular tests only. |
| `integration-test` | Run opt-in integration tests only. |

The root Makefile should expose:

| Target | Meaning |
|---|---|
| `test` | Run every project's regular tests. |
| `integration-test` | Run every project's integration tests. |
| `<project>-test` | Run one project's regular tests. |
| `<project>-integration-test` | Run one project's integration tests. |

If a project has no integration tests yet, its `integration-test` target may
print a short message and exit successfully.

## Package Scripts

When a project has package-manager scripts, keep their names aligned with the
Makefile lane:

- `test`: regular tests only
- `test:integration`: integration tests only

The Makefile remains the repository-level interface. Package scripts are
project-local implementation details.

## Documentation

Project testing docs should describe:

- the regular test command
- the integration test command
- any services the integration tests start
- required local dependencies
- expected runtime data, temp directories, or cleanup behavior
- any smoke or manual checks that are intentionally outside integration tests

Exact commands and contracts belong in `projects/<project>/docs/operations.md`,
the normative operations document of the project's living spec. See
[Docs Structure](docs-structure.md).
