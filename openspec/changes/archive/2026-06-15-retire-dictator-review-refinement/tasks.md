## 1. Spec updates

- [x] 1.1 Sync the `dictator-dictation-pipeline` delta: remove requirements dp-22 and dp-24 and the "Launchpad review dictation starts" scenario from dp-26 in `openspec/specs/dictator-dictation-pipeline/spec.md` (leave dp-23 untouched). (Delta written and validated; applied to the live spec at archive time.)
- [x] 1.2 Fix the `dictator-launchpad` Contracts prose at `openspec/specs/dictator-launchpad/spec.md` so `(2,7)` is no longer described as "reserved for the voice diff review control layer" (align with lp-25).
- [x] 1.3 Replace the `Purpose: TBD` header in `openspec/specs/dictator-websocket-rpc/spec.md` with a real purpose describing the generic local WebSocket RPC surface (cell ownership, cursor insertion, dictation context push/pop).
- [x] 1.4 Replace the `Purpose: TBD` header in `openspec/specs/sheaf-chat-agent-review-mode/spec.md` with a real purpose describing Sheaf Chat-owned Agent Review Mode (hunk review state, comments, serialization, Launchpad control via Dictator RPC).
- [x] 1.5 Genericize the lingering "focused review hunk" wording in `openspec/specs/dictator-websocket-rpc/spec.md` (~line 101) so the generic spec does not assume review semantics.

## 2. Verify no consumers before deleting code

- [x] 2.1 Grep Dictator sources for any refinement/dictation consumer of `reviewSystemPrompt` (expect none) to confirm removal is behavior-neutral. (None found.)
- [x] 2.2 Grep Sheaf Chat and the Dictator web UI/dashboard JS for the `review_system_prompt` API field (expect none) to confirm no external consumer. (Sheaf Chat: none. Dictator dashboard `app.js:347` lists it as a top settings field — folded into web removal.)

## 3. Remove dead Dictator code

- [x] 3.1 Remove the `reviewSystemPrompt` field, init param, coding key, decode/encode, and the `resolvedReviewSystemPrompt` validation from `projects/dictator/src/Sources/DictatorCore/RuntimeConfig.swift` (including the patch struct field).
- [x] 3.2 Remove the `.review` case and its patch/value handlers from the `Target` enum in `projects/dictator/src/Sources/DictatorCore/RuntimeConfiguration.swift`.
- [x] 3.3 Remove `defaultReviewPromptFile` from `projects/dictator/src/Sources/DictatorCore/SystemPromptCatalog.swift`.
- [x] 3.4 Remove the `review_system_prompt` fields, field-mapping keys, and UI labels from `projects/dictator/src/Sources/DictatorService/WebAPIModels.swift`.
- [x] 3.5 Remove review handling (status response field, PATCH field, change detection, `target=review` validation, field-getter case) from `projects/dictator/src/Sources/DictatorService/WebAPIService.swift`.
- [x] 3.6 Remove the review prompt configuration manager wiring from `projects/dictator/src/Sources/DictatorService/WebServiceFactory.swift`.
- [x] 3.7 Delete the orphaned prompt file `projects/dictator/src/prompts/system-prompts/code_review_refiner_v1.md`.
- [x] 3.8 Confirm a config file containing a stale `review_system_prompt` key still decodes (unknown key ignored); add a small decode test if not already covered. (Added a stale key to a decode test in `RuntimeConfigProviderTests`.)
- [x] 3.9 (Discovered during apply) Remove the dead `review_system_prompt` top-settings field from `projects/dictator/src/web/app.js` and the `<option value="review">Review</option>` from `projects/dictator/src/web/index.html`.

## 4. Remove dead tests

- [x] 4.1 Remove the review-prompt test(s) in `projects/dictator/tests/DictatorCoreTests/RuntimeConfigurationManagerTests.swift`.
- [x] 4.2 Remove the review-prompt assertions/cases in `projects/dictator/tests/DictatorServiceTests/WebAPITests.swift` (status field, PATCH, `target=review` selection); keep unrelated injectable-rules cases, switching any `code_review_refiner_v1.md` fixture to a non-review sample prompt.
- [x] 4.3 (Discovered during apply) Remove the review assertion and `testApplyInMemoryPatchUpdatesReviewPromptPath` from `projects/dictator/tests/DictatorCoreTests/RuntimeConfigProviderTests.swift`.

## 5. Docs

- [x] 5.1 Remove the `review_system_prompt` row and example from `projects/dictator/docs/contracts/config.md`.
- [x] 5.2 Fix the review-prompt wording in `projects/dictator/docs/operations.md`. (No change needed — the RPC section already describes Sheaf Chat ownership of `(3,3)` accurately.)
- [x] 5.3 Sweep `projects/dictator/docs/coverage.md` for references to dp-22/dp-24 or the removed tests and update. (No references found.)

## 6. Validation

- [x] 6.1 Run `make dictator-test` and confirm green. (207 tests, 0 failures.)
- [x] 6.2 Run `make test` (or at least `make dictator` and `make sheaf-chat-test`) to confirm the repo build is unaffected. (Dictator green: 207/207. Sheaf Chat green after `npm install`: 187/187 — one `agentReview` test is order-dependent/flaky, passes in isolation and on re-run; unrelated to this change, which touches no Sheaf Chat code.)
- [x] 6.3 Run `openspec validate retire-dictator-review-refinement` (or `openspec status`) to confirm the change is consistent before archiving. (Valid.)
