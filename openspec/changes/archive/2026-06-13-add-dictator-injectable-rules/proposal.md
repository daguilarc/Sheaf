## Why

Dictator sometimes needs prompt-specific guidance only when a dictation mentions certain words or phrases. Today those instructions must live in the general refiner prompt, which makes rare or context-specific guidance apply to every refinement instead of only the relevant transcript.

## What Changes

- Add a config-backed key-value object of injectable refinement rules where each key is a trigger string and each value is a prompt file path relative to `system_prompts_dir`.
- During refinement, match each configured key against the raw Whisper transcript using case-insensitive simple string matching.
- When one or more keys match, load each matched prompt file and append its contents to the end of the system/refinement prompt used for that request.
- Preserve the original transcript and refinement input data; injectable rules only affect the prompt sent to the refiner.
- Add web UI controls to view all rules, add new trigger-to-prompt-file pairs with a plus action, and delete existing pairs.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `dictator-dictation-pipeline`: Adds config-driven prompt injection during refinement without mutating transcripts or request input.
- `dictator-web-ui`: Adds management UI and API support for the injectable rules stored in `config/dictator.json`.

## Impact

- Affects `projects/dictator` runtime config decoding, defaults, persistence, prompt-file validation, and documentation for `config/dictator.json`.
- Affects refinement prompt assembly for OpenAI, Ollama, provider routing, launchpad-driven refinement, and HTTP dictation paths that share the refiner engines.
- Affects Dictator web API models/routes as needed to expose and patch the rules object, plus the static dashboard UI.
- Requires focused tests for config decode/persist, prompt injection matching behavior, and web UI/API rule management.
