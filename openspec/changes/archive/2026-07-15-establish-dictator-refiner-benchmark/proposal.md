## Why

The refiner exploration produced useful prompts, synthetic cases, full-corpus runs, judge outputs, and reports, but the artifacts are split between untracked project files and ignored data in a disposable worktree. Dictator also cannot reproduce the selected Luna-low configuration because its OpenAI request omits reasoning effort.

## What Changes

- Retrospectively document the completed prompt/model evaluation without rerunning it or treating historical outputs as golden truth.
- Establish a durable benchmark layout that tracks code, prompt versions, synthetic and human-reviewed cases, manifests, aggregate results, and reports while keeping personal transcripts and raw model/judge traces private and ignored.
- Preserve enough run metadata and hashes to identify the exact dataset, prompt set, model, reasoning effort, and evaluator behind a result.
- Add an optional, validated `reasoning_effort` runtime setting and include it in OpenAI Responses API requests only when configured.
- Define the remaining rollout from the current GPT-4.1-mini configuration to `gpt-5.6-luna` with low reasoning and the selected conservative/Blark/Borg prompts.
- Record follow-up safety work for interaction metadata, human disagreement cases, and deterministic marker handling.

## Capabilities

### New Capabilities

- `dictator-refiner-benchmark`: Durable datasets, run manifests, private result storage, evaluation gates, and reports for comparing Dictator refinement configurations.

### Modified Capabilities

- `dictator-dictation-pipeline`: Allow the OpenAI refinement request to use an optional configured reasoning effort so a selected model configuration can be reproduced.

## Impact

- Adds tracked experiment definitions and documentation under `projects/dictator/experiments/refiner-benchmark/` and `projects/dictator/docs/experiments/`.
- Defines ignored persistent storage under `data/dictator/experiments/refiner-benchmark/` for personal source transcripts and raw API traces.
- Changes Dictator runtime configuration, `LLMRuntimeConfiguration`, OpenAI request encoding, and their focused tests.
- A later rollout will update `config/dictator.json` and production prompt catalog files; this proposal does not itself land or deploy those choices.
