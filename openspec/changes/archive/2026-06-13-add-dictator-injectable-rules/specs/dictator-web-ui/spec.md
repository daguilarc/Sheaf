## ADDED Requirements

### Requirement: web-18 — Injectable rules management
WHEN the dashboard manages injectable rules, THE Dictator service SHALL expose the `injectable_rules` object from `config/dictator.json` as editable trigger-to-prompt-file pairs, allow adding or replacing a non-empty trigger key with a valid prompt file path relative to `system_prompts_dir`, allow deleting an existing key, persist successful changes atomically, and render the current stored pairs in the web UI.

#### Scenario: View injectable rules
- **WHEN** the dashboard loads the injectable rules section
- **THEN** it shows all currently stored `injectable_rules` pairs from runtime config

#### Scenario: Add injectable rule
- **WHEN** the user enters a non-empty trigger key, chooses a valid prompt file path, and activates the plus control
- **THEN** the service stores that pair in `config/dictator.json` and the dashboard renders it in the current rules list

#### Scenario: Replace injectable rule prompt file
- **WHEN** the user adds a rule with a key that already exists
- **THEN** the service replaces the existing prompt file path for that key and the dashboard renders the updated path

#### Scenario: Delete injectable rule
- **WHEN** the user activates the delete control for an existing injectable rule
- **THEN** the service removes that key from `config/dictator.json` and the dashboard no longer renders it

#### Scenario: Reject invalid injectable rule edits
- **WHEN** an injectable rule edit contains a blank key, blank prompt file path, absolute prompt file path, escaping prompt file path, unknown prompt file path, empty prompt file, or a delete request for a blank key
- **THEN** the service rejects the edit with a 400 error and does not mutate runtime config
