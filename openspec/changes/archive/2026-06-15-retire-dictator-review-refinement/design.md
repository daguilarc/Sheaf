## Context

The `generic-dictator-rpc-review-mode` change moved Agent Review ownership from Dictator to Sheaf Chat and retired the `dictator-voice-diff-review` capability, but its delta set did not include `dictator-dictation-pipeline`. As a result, three requirement artifacts and a layer of code/doc plumbing survived that no longer match the architecture:

- Spec `dp-22` (review prompt config), `dp-24` (hunk-aware review refinement), and a stale `dp-26` scenario reference a Dictator-owned review audio mode that was removed (and `dp-24`'s behavior was never implemented in the refinement engine).
- The `reviewSystemPrompt` runtime-config field is threaded through `RuntimeConfig`, `RuntimeConfiguration` (a `.review` target), the web API, the web dashboard, and `SystemPromptCatalog`, plus the prompt file `code_review_refiner_v1.md` and dedicated tests — yet no refinement engine ever reads it.

The generic replacement is already in place and correct: Sheaf Chat pushes hunk context over `dictator-websocket-rpc` (`dictationContext.push`), and Dictator renders it into ordinary dictation via the reusable structured-context-block behavior (`dp-23`, `RefinementContextBlock`). This change removes the leftovers without touching that path.

## Goals / Non-Goals

**Goals:**
- Make `dictator-dictation-pipeline` describe only behavior that exists: remove `dp-22`/`dp-24`, trim the `dp-26` review scenario.
- Delete the dead `reviewSystemPrompt` code path and its tests so the dashboard no longer exposes a no-op "Review Prompt" field.
- Fix non-normative stale text: the `dictator-launchpad` `(2,7)` Contracts line and the two `Purpose: TBD` spec headers.
- Keep the build/tests green and behavior identical.

**Non-Goals:**
- No change to the generic context-block mechanism (`dp-23`), `dictator-websocket-rpc`, or Sheaf Chat Agent Review Mode behavior.
- No re-introduction of any review-specific refinement in Dictator.
- No renumbering of existing requirement IDs (`dp-22`/`dp-24` are retired, not reused).

## Decisions

- **Remove rather than deprecate `reviewSystemPrompt`.** It has no consumer, so there is no compatibility surface worth preserving. Removing the field, the `.review` config target, the web-API fields/labels/validation, and the catalog default eliminates the misleading dashboard control entirely. Alternative (keep it, mark legacy) was rejected: it leaves a live no-op setting users can edit.
- **Delete `code_review_refiner_v1.md`.** It is only referenced as the now-removed default; nothing loads it at runtime.
- **Treat the Launchpad `(2,7)` Contracts line and the `Purpose: TBD` headers as direct, non-normative spec edits** (not requirement deltas). They change no requirement, so they are not expressed as delta operations; they are applied straight to the live specs during implementation. The `dictator-launchpad` requirement `lp-25` already governs `(2,7)` correctly and is unchanged.
- **Config-file decoding stays tolerant.** Removing the `review_system_prompt` decode key means existing on-disk configs that still contain the key will simply ignore it (unknown keys are not fatal). Verify this during implementation so no user config fails to load.

## Risks / Trade-offs

- [An on-disk config still containing `review_system_prompt` could fail to decode] → Confirm the config decoder ignores unknown keys; add/keep a decode test if needed. The field is optional today, so dropping it should be safe.
- [Coverage/contract docs may pin the removed requirements or tests] → Sweep `projects/dictator/docs/coverage.md` and `docs/contracts/config.md` and update any references as part of the change.
- [Hidden consumer of the web-API `review_system_prompt` field] → Grep Sheaf Chat and the Dictator web UI for the field before deletion; the audit found none, but re-verify at apply time.

## Migration Plan

1. Apply the spec delta (`dp-22`/`dp-24` removed, `dp-26` modified) and sync to the live spec.
2. Apply the non-normative spec prose fixes (`dictator-launchpad` Contracts, two `Purpose` headers).
3. Remove the `reviewSystemPrompt` field, `.review` target, web-API surface, and catalog default; delete `code_review_refiner_v1.md`.
4. Remove the dead review-prompt tests; run the Dictator Swift test suite.
5. Update `docs/contracts/config.md`, `docs/operations.md`, and `coverage.md` as needed.
6. Run `make dictator-test` (and `make test`) to confirm green.

Rollback is a straight revert of the change commit; no data migration is involved.

## Open Questions

- None. The audit confirmed `reviewSystemPrompt` has no pipeline or external consumer; re-verify with a grep at apply time before deleting the web-API field.
