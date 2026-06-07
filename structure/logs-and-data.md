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

## Model Assets

Large local model binaries should live under:

```text
models/
```

Model assets are runtime dependencies and are ignored by git. For example, Dictator's default STT config points to `models/ggml-base.en.bin`, which resolves to `/Users/joyo/Sheaf/models/ggml-base.en.bin` when the service runs in this repository. During the Dictator migration, the existing Whisper.cpp model was copied from `/Users/joyo/dictator/apps/dictator-main/models/ggml-base.en.bin` into that Sheaf path instead of being committed.

## Project Names

Use the project directory name from `projects/<project>/` as the `<project>` segment in `logs/<project>/`, `data/<project>/`, and `config/<project>.json`.
