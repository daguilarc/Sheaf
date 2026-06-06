# Configuration

All repository configuration lives in `config/`.

## Required Files

- `config/api_keys.json`: local API keys and secrets. This file is git-ignored.
- `config/global_config.json`: shared repository-wide settings.
- `config/services.json`: service registry for long-running services.
- `config/<project>.json`: optional project-specific config for projects that need additional config.

## Rules

- Do not use environment variables for project configuration.
- Do not create ad hoc local config files outside `config/`.
- Project config should contain only project-specific settings.
- Secrets belong only in `config/api_keys.json`.
