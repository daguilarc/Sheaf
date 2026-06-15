## MODIFIED Requirements

### Requirement: dp-26 — Non-Talon dictation forces Talon asleep
WHEN any non-Talon Dictator dictation starts, THE Dictator service SHALL send a Talon sleep command before recording or processing begins, regardless of Talon's cached, queried, or expected current state.

#### Scenario: HTTP dictation starts
- **WHEN** `POST /v1/dictate-audio` starts processing a valid dictation request
- **THEN** Dictator sends Talon a sleep command before transcription begins

#### Scenario: Launchpad standard dictation starts
- **WHEN** Launchpad standard dictation starts recording
- **THEN** Dictator sends Talon a sleep command before audio recording begins

#### Scenario: Launchpad auxiliary dictation starts
- **WHEN** Launchpad auxiliary dictation starts recording
- **THEN** Dictator sends Talon a sleep command before audio recording begins

#### Scenario: Talon already asleep
- **WHEN** Dictator starts non-Talon dictation and Talon is already asleep
- **THEN** Dictator still sends the Talon sleep command

#### Scenario: Talon bridge unavailable
- **WHEN** Dictator starts non-Talon dictation and the Talon bridge is unavailable
- **THEN** Dictator logs the failed sleep attempt and continues starting the non-Talon dictation

## REMOVED Requirements

### Requirement: dp-22 — Review refinement prompt configuration
**Reason**: Dictator no longer owns voice diff review; review ownership moved to Sheaf Chat Agent Review Mode in the `generic-dictator-rpc-review-mode` change. The `review_system_prompt` config field has no consumer in the dictation/refinement pipeline.
**Migration**: Sheaf Chat owns review state and comment editing. Review comments are dictated normally into a Sheaf Chat text box; hunk context reaches normal dictation through the generic pushed-context mechanism (`dictator-websocket-rpc` `dictationContext.push` rendered via dp-23). No Dictator-side review prompt configuration is needed.

### Requirement: dp-24 — Hunk-aware review refinement input
**Reason**: This described a Dictator-owned review-comment refinement mode that was retired with the `dictator-voice-diff-review` capability and was never implemented in the refinement engine.
**Migration**: Hunk context is supplied to ordinary dictation as a generic structured context block via `dictator-websocket-rpc` `dictationContext.push`, rendered by the existing reusable-context-block behavior (dp-23). There is no separate review-refinement input path.
