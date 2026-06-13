## ADDED Requirements

### Requirement: dp-25 — Injectable refinement rules
WHEN building the system prompt for a non-empty refinement request, THE dictation pipeline SHALL read `injectable_rules` from the current runtime config, case-insensitively match each non-empty key against the raw Whisper transcript using simple substring matching, resolve each matching value as a prompt file path relative to `system_prompts_dir`, and append the contents of each resolved prompt file to the end of the system prompt sent to the selected refinement provider.

#### Scenario: Matching rule appended to prompt
- **WHEN** `injectable_rules` contains `"dogs": "dog_rules.md"`, `dog_rules.md` contains `dogs are cool`, and the raw Whisper transcript contains `Dogs`
- **THEN** the refinement provider receives a system prompt with `dogs are cool` appended after the selected system prompt body

#### Scenario: Non-matching rule omitted
- **WHEN** `injectable_rules` contains `"dogs": "dog_rules.md"` and the raw Whisper transcript does not contain `dogs` in any casing
- **THEN** the refinement provider receives the selected system prompt body without loading or appending `dog_rules.md`

#### Scenario: Transcript and refinement input preserved
- **WHEN** one or more injectable rules match a raw Whisper transcript
- **THEN** the pipeline preserves the raw transcript and refinement input content and only changes the system prompt sent to the refinement provider

#### Scenario: Multiple matches are deterministic
- **WHEN** multiple injectable rule keys match the raw Whisper transcript
- **THEN** the pipeline appends each matching prompt file's contents in stable case-insensitive key order

#### Scenario: Missing injectable prompt file skipped
- **WHEN** an injectable rule matches but its configured prompt file cannot be resolved or read from the prompt catalog
- **THEN** the pipeline skips that injectable rule for the current request and continues refinement with the remaining prompt content

#### Scenario: Empty rules produce existing prompt
- **WHEN** `injectable_rules` is missing or empty in runtime config
- **THEN** the pipeline uses the selected system prompt body exactly as it did before injectable rules
