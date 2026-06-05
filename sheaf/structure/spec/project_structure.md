# Project Structure

The `sheaf` directory is the root for unified project organization.

## Project Directory

A project is a direct subdirectory of `sheaf`.

Each project contains:

- `specs/`: project specifications.
- `tasks/`: project tasks.
- `src/`: project source code.
- `tests/`: project tests.
- `README.md`: instructions for running the project.

## Logs

Project logs are stored under `sheaf/logs`.

Each project writes logs to its own subdirectory:

```text
sheaf/logs/<project_slug>/
```

## Configuration

Configuration is stored as JSON files under `sheaf/config`.

The `sheaf/config` directory contains:

- Global configuration.
- Project-specific configuration.

