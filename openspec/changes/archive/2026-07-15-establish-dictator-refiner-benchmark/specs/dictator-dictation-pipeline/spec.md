## MODIFIED Requirements

### Requirement: dp-18 — Pipeline behavior: OpenAI engine HTTP call
THE OpenAI engine SHALL call `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <key>` and body containing `model`, `instructions`, and `input`; WHERE optional `reasoning_effort` is configured, THE engine SHALL additionally send `"reasoning": {"effort": "<configured-value>"}`, and WHERE it is absent the engine SHALL omit `reasoning`; the engine SHALL read `output_text` or the first non-empty `output[].content[].text`; a missing key fails with `Missing OpenAI API key`, HTTP 401/403 with `Invalid OpenAI API key`, and connectivity errors with `Network unavailable`.

#### Scenario: OpenAI responses call without reasoning effort
- **WHEN** the OpenAI engine performs refinement and `reasoning_effort` is absent
- **THEN** it calls `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <key>` and body containing `model`, `instructions`, and `input` while omitting `reasoning`, then reads `output_text` or the first non-empty `output[].content[].text`

#### Scenario: OpenAI responses call with reasoning effort
- **WHEN** the OpenAI engine performs refinement and `reasoning_effort` is `low`
- **THEN** its request body includes `"reasoning": {"effort": "low"}`

#### Scenario: Missing OpenAI API key
- **WHEN** no OpenAI API key is configured
- **THEN** refinement fails with `Missing OpenAI API key`

#### Scenario: OpenAI 401/403 response
- **WHEN** the OpenAI API responds with HTTP 401 or 403
- **THEN** refinement fails with `Invalid OpenAI API key`

#### Scenario: OpenAI connectivity error
- **WHEN** a connectivity error occurs reaching the OpenAI API
- **THEN** refinement fails with `Network unavailable`

## ADDED Requirements

### Requirement: dp-27 — Runtime configuration: Optional OpenAI reasoning effort
WHEN Dictator loads runtime configuration, THE service SHALL accept an optional `reasoning_effort` value from the supported vocabulary `none`, `low`, `medium`, `high`, `xhigh`, or `max`, carry it through `LLMRuntimeConfiguration` to every OpenAI refinement path, preserve it when runtime configuration is saved or otherwise patched, and reject values outside that vocabulary.

#### Scenario: Low reasoning is configured
- **WHEN** `config/dictator.json` contains `"reasoning_effort": "low"`
- **THEN** the loaded runtime and LLM configurations expose low reasoning to both primary OpenAI and Ollama-to-OpenAI fallback refinement paths

#### Scenario: Reasoning effort is omitted
- **WHEN** `reasoning_effort` is absent from runtime configuration
- **THEN** the loaded value is absent and OpenAI request behavior remains compatible with the pre-change configuration

#### Scenario: Runtime configuration is patched
- **WHEN** a runtime setting other than reasoning effort is patched while reasoning effort is configured
- **THEN** the resulting persisted configuration preserves the configured reasoning effort

#### Scenario: Unsupported reasoning effort is loaded
- **WHEN** runtime configuration contains a `reasoning_effort` value outside the supported vocabulary
- **THEN** configuration decoding rejects the unsupported value rather than silently changing or omitting it
