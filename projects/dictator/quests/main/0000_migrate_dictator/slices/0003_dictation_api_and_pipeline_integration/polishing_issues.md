# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T00:00:00Z
- updated_at: 2026-06-07T00:00:00Z
- title: Interaction history records unreliable provider/model and omits fallback info
- details: |
  In `projects/dictator/src/Sources/DictatorService/HTTPInteractionRecorder.swift`,
  the success handler determines the persisted provider via `EffectiveProvider()`,
  which substring-matches the LLM-generated `edit_summary` for the literal strings
  `OpenAI`/`Ollama` (case-insensitive) and otherwise falls back to the configured
  `runtimeConfiguration.provider`. The persisted `effectiveModel` is then derived
  from that inferred provider.

  What is wrong:
  - `edit_summary` is model-authored edit-description text, not a provider tag.
    `ProviderRoutingRefinementEngine.refine()` returns the underlying engine's
    `RefineResponse` verbatim, so `edit_summary` will essentially never contain the
    word "OpenAI"/"Ollama" (the success test uses `edit_summary: "capitalized"`).
    The inference therefore almost always collapses to the configured provider.
  - `RuntimeConfigRefinementEngine` -> `ProviderRoutingRefinementEngine` can
    transparently fall back Ollama -> OpenAI
    (`ProviderRoutingRefinementEngine.swift:26-33`), but
    `DictateCallResult`/`DictateResponse` (`Contracts.swift:105-129`) carry no
    provider/model/fallback signal. So when a fallback occurs, the recorded provider
    AND model are wrong (they report the configured provider, not the one actually
    used), and no fallback indicator is persisted at all.
  - The heuristic can also misattribute the provider if a model's edit summary
    coincidentally mentions "OpenAI"/"Ollama", introducing nondeterministic data.

  Why it is a problem:
  - The slice plan (physicalplan/plan.md, Implementation Notes) requires interaction
    persistence to record "provider/model/fallback info when available" for slice 4
    (web UI) consumption. As written, the persisted provider/model can silently
    misattribute the provider used and never records fallback occurrence, undermining
    the slice-4 data contract precisely in the fallback case the spec calls out.

  What must be true to mark this issue completed:
  - The persisted `DictationInteraction` provider and model reflect the provider
    actually used for the request (including the Ollama -> OpenAI fallback case),
    rather than a substring guess against `edit_summary`.
  - Fallback occurrence is captured in the persisted record when available.
  - Provider/model are sourced from an authoritative signal (e.g. plumbed through
    `DictateCallResult`/`PipelineOrchestrator`/`ProviderRoutingRefinementEngine`) or,
    at minimum, from the deterministically-known configured provider/model instead of
    `edit_summary` text matching.
  - Test coverage exercises the fallback scenario and asserts the recorded
    provider/model/fallback metadata.
- resolution_notes: none
