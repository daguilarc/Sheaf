# Glossary

## Command Hub

The repository role: one place to manage multiple [projects](repo-layout.md#project-directory-shape), their [configuration](configuration.md), [services](services.md), [logs](logs-and-data.md#logs), [data](logs-and-data.md#data), and work records.

## Project

A self-contained unit under [`projects/<project>/`](repo-layout.md#project-directory-shape) with its own source, tests, [docs](docs-structure.md), quests, and README.

## Quest

A record of planned or active work. [Quests](project-rules.md#quests-versus-docs) describe things to be done, not the stable current state.

## Docs

Current-state [documentation](docs-structure.md). Docs describe how the repo or project works now.

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

## Global Config

Shared repository-wide settings stored in [`config/global_config.json`](../config/global_config.json). See [Configuration](configuration.md).

## Project Config

Optional project-specific settings stored in `config/<project>.json`. See [Configuration](configuration.md).

## API Keys

Local secrets stored in `config/api_keys.json`. This file is ignored by git. See [Configuration](configuration.md).
