## ADDED Requirements

### Requirement: dp-22 — Review refinement prompt configuration
THE Dictator runtime configuration SHALL include `review_system_prompt`, a prompt file path relative to `system_prompts_dir`, and SHALL default it to `code_review_refiner_v1.md` when the key is missing or blank.

#### Scenario: Review prompt key present
- **WHEN** runtime config contains `review_system_prompt`
- **THEN** Dictator uses that prompt file for voice diff review refinement

#### Scenario: Review prompt key missing
- **WHEN** runtime config omits `review_system_prompt` or sets it blank
- **THEN** Dictator falls back to `code_review_refiner_v1.md` for voice diff review refinement

#### Scenario: Review prompt selectable
- **WHEN** the runtime config API returns or updates selectable prompt settings
- **THEN** `review_system_prompt` is exposed and validated like the other prompt file settings

### Requirement: dp-23 — Reusable refinement context blocks
WHEN a dictation or refinement mode provides structured context blocks, THE dictation pipeline SHALL render those blocks into the refinement input in a stable delimited form before the raw transcript so mode-specific context can be reused without custom prompt string assembly.

#### Scenario: Context blocks included
- **WHEN** a refinement request contains one or more structured context blocks
- **THEN** the refinement input includes each block title, metadata, and body text before the raw transcript

#### Scenario: No context blocks
- **WHEN** a refinement request contains no structured context blocks
- **THEN** the pipeline preserves the existing refinement input behavior for standard dictation

#### Scenario: Future modes reuse context blocks
- **WHEN** a future dictation mode needs to inject non-hunk context
- **THEN** it can supply additional structured context blocks without adding a new prompt assembly path

### Requirement: dp-24 — Hunk-aware review refinement input
WHEN refining a voice diff review comment, THE dictation pipeline SHALL build refinement input from the raw transcript plus a structured hunk review context block and SHALL NOT use the selected-text replacement template for this mode.

#### Scenario: Hunk context included
- **WHEN** Dictator refines a review-comment recording
- **THEN** the refinement input includes a structured context block containing the hunk file path, header, patch hash, and patch text before the raw transcript

#### Scenario: Review prompt asks for code review
- **WHEN** Dictator loads the default review prompt
- **THEN** the prompt instructs the model to refine the user's spoken code review comment while preserving the review intent

#### Scenario: No selected text replacement
- **WHEN** Dictator refines a review-comment recording and optional context contains hunk fields
- **THEN** the refinement input does not use the selected-text transform template
