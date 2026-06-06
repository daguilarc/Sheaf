# Logs And Data

Runtime output is grouped by project at the repository root.

## Logs

Every project should write logs to:

```text
logs/<project>/
```

Log files are runtime output and are ignored by git.

## Data

Every project should write runtime data to:

```text
data/<project>/
```

Runtime data is ignored by git. If a project needs committed fixtures or sample data, place them under that project's `tests/` or `docs/` directory and label them clearly.

## Project Names

Use the project directory name from `projects/<project>/` as the `<project>` segment in `logs/<project>/`, `data/<project>/`, and `config/<project>.json`.
