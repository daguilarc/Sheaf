# Glossary

## Command Hub

The repository role: one place to manage multiple [projects](repo-layout.md#project-directory-shape), their [configuration](configuration.md), [services](services.md), [logs](logs-and-data.md#logs), [data](logs-and-data.md#data), and work records.

## Project

A self-contained unit under [`projects/<project>/`](repo-layout.md#project-directory-shape) with its own source, tests, [docs](docs-structure.md), quests, and README.

## Quest

A record of planned or active work. [Quests](project-rules.md#quests-versus-docs) describe things to be done, not the stable current state. A quest's `specs/` directory is a [delta spec](#delta-spec).

## Docs

A project's [living spec](#living-spec): capability specs under `openspec/specs/` plus the supporting docs under `projects/<project>/docs/`. See [Docs Structure](docs-structure.md).

## Living Spec

The normative description of a project's current behavior, organized by [capability](#capability) under `openspec/specs/` (with architecture, operations, coverage, and shared contracts in the project's `docs/` directory) and held to the [rebuild test](#rebuild-test) standard. See [Docs Structure](docs-structure.md).

## Delta Spec

An OpenSpec change's `specs/` directory (`openspec/changes/<change-id>/specs/`): `## ADDED/MODIFIED/REMOVED Requirements` written against the main specs. Archiving the change merges the delta into `openspec/specs/`.

## Capability

A coherent externally visible behavior of a project, specified in one spec at `openspec/specs/<project>-<capability>/spec.md`. See [Docs Structure](docs-structure.md#project-docs-layout).

## Requirement ID

A stable, append-only identifier (`<prefix>-<n>`) for one externally observable requirement in a capability spec, embedded in the requirement header (`### Requirement: <id> — <name>`). Never renumbered or reused; retired requirements keep their ID in the spec's `## Retired Requirements` section. See [Docs Structure](docs-structure.md#requirement-rules-ears).

## Rebuild Test

The living-spec quality bar: a fresh agent given only `docs/` and `tests/` could, in principle, reimplement the project and pass its tests. See [Docs Structure](docs-structure.md#the-rebuild-test).

## Service

A long-running process registered in [`config/services.json`](../config/services.json). See [Services](services.md).

## Home Path

An optional service registry field for the service's main human-facing page. See [Services](services.md#registry-file).

## Web UI

An optional browser interface for a project service. Shared web UI utilities live in the [`web` project](webui.md).

## Conductor

The future project responsible for managing [services](services.md) registered in [`config/services.json`](../config/services.json).

## Quest Runner

The future migrated project responsible for managing project [quests](project-rules.md#quests-versus-docs).

## Land

`land <branch>` means rebase `<branch>` onto `main`, then fast-forward `main` to
`<branch>`:

```bash
git rebase main <branch>
git checkout main
git merge --ff-only <branch>
```

## Global Config

Shared repository-wide settings stored in [`config/global_config.json`](../config/global_config.json). See [Configuration](configuration.md).

## Project Config

Optional project-specific settings stored in `config/<project>.json`. See [Configuration](configuration.md).

## API Keys

Local secrets stored in `config/api_keys.json`. This file is ignored by git. See [Configuration](configuration.md).
