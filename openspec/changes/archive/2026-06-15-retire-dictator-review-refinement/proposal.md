## Why

The `generic-dictator-rpc-review-mode` change moved Agent Review ownership out of Dictator into Sheaf Chat, but it only retired the `dictator-voice-diff-review` capability and the Launchpad review pad. It never updated `dictator-dictation-pipeline`, leaving requirements for a Dictator-owned review-refinement audio mode that no longer exists (and, in the case of `dp-24`, was never implemented). The matching `review_system_prompt` config field, web-API surface, default prompt file, and tests remain in Dictator as dead plumbing — exposing an editable "Review Prompt" in the dashboard that has no effect. This change finishes that move so the specs, code, and docs reflect the actual architecture.

## What Changes

- Remove `dictator-dictation-pipeline` requirement **dp-22** (review refinement prompt configuration) and **dp-24** (hunk-aware review refinement input). dp-24 was never implemented; both describe the retired Dictator-owned review audio mode.
- Modify **dp-26** to drop the stale "Launchpad review dictation starts" scenario; Launchpad no longer starts review dictation (forbidden by `dictator-launchpad` lp-25).
- Keep **dp-23** (reusable refinement context blocks) unchanged — it is the generic, correctly-implemented mechanism by which Sheaf Chat's pushed hunk context now reaches normal dictation via `dictationContext.push`.
- Remove dead Dictator code with no pipeline consumer: the `reviewSystemPrompt` runtime-config field + validation, the `.review` config target, the web-API status/patch/selection surface, `SystemPromptCatalog.defaultReviewPromptFile`, the orphaned `code_review_refiner_v1.md` prompt, and the review-prompt tests in `RuntimeConfigurationManagerTests` and `WebAPITests`.
- Fix the stale `dictator-launchpad` Contracts prose that still calls `(2,7)` "reserved for the voice diff review control layer" (contradicts lp-25). Non-normative; no requirement change.
- Fill the placeholder `Purpose: TBD` statements in the `dictator-websocket-rpc` and `sheaf-chat-agent-review-mode` specs. Non-normative; no requirement change.
- Update stale Dictator docs: `docs/contracts/config.md` (review_system_prompt row + example) and `docs/operations.md` review-prompt wording.

No runtime behavior changes: `review_system_prompt` is never read by the dictation/refinement pipeline.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `dictator-dictation-pipeline`: Remove requirements dp-22 and dp-24; modify dp-26 to drop the Launchpad-review-dictation scenario.

Non-normative spec edits (no requirement deltas, applied directly during implementation): `dictator-launchpad` (Contracts prose for `(2,7)`), `dictator-websocket-rpc` (Purpose), `sheaf-chat-agent-review-mode` (Purpose).

## Impact

- Specs: `openspec/specs/dictator-dictation-pipeline/spec.md` (requirement removals/modification), plus prose fixes in `dictator-launchpad`, `dictator-websocket-rpc`, and `sheaf-chat-agent-review-mode`.
- Code: `projects/dictator/src/Sources/DictatorCore/{RuntimeConfig,RuntimeConfiguration,SystemPromptCatalog}.swift`; `projects/dictator/src/Sources/DictatorService/{WebAPIModels,WebAPIService,WebServiceFactory}.swift`; `projects/dictator/src/prompts/system-prompts/code_review_refiner_v1.md` (delete).
- Tests: remove review-prompt cases in `projects/dictator/tests/DictatorCoreTests/RuntimeConfigurationManagerTests.swift` and `projects/dictator/tests/DictatorServiceTests/WebAPITests.swift`.
- Docs: `projects/dictator/docs/contracts/config.md`, `projects/dictator/docs/operations.md`, and the dictator `coverage.md` if it references the removed requirements/tests.
