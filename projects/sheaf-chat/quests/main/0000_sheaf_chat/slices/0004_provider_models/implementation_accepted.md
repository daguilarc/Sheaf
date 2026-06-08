# Slice 0004 Provider Models — Implementation Accepted

## Summary

The slice implements Sheaf-scoped Pi auth storage, a model registry that merges
OpenAI subscription/OAuth-backed models with a local OpenAI-compatible inference
provider, and reusable model listing/validation. After two review cycles all
polishing issues are resolved and verified.

## Verification of objectives

- **Auth isolation**: `auth.ts` roots auth/models/openai paths under
  `data/sheaf-chat/` and guards against global `~/.pi` paths
  (`AssertNotGlobalPiPath`). No global Pi reads at runtime.
- **Config plumbing**: `config.ts` reads top-level `local_inference_url`
  (`global_config.json`) and `local_inference_api_key` / `openai_api_key`
  (`api_keys.json`); no nested `sheaf_chat` object.
- **Local provider**: `localProvider.ts` performs `/v1/models` discovery with
  injectable fetch, fallback unavailable model, OpenAI-completions compat flags,
  and stable unavailable-reason codes for missing url/key and fetch failure.
- **Model registry**: `models.ts` provides `CreateSheafModelRegistry`,
  `ListModels`, `ValidateModelSelection`, and metadata mapping; OpenAI runtime
  key wiring confirmed working via `hasConfiguredAuth`.

## Resolved polishing issues

- **PL-0001** (completed): Slice tests were located in `tests/agents/models/`,
  silently matched by the repo `.gitignore` `models/` rule. Tests relocated to
  the non-ignored `tests/agents/modelRegistry/` and are now tracked by git
  (`git ls-files` confirms `auth.test.ts`, `helpers.ts`, `models.test.ts`); the
  old ignored directory is removed and the intended `models/` ignore behavior is
  preserved.
- **PL-0002** (completed): Added OpenAI availability coverage — `ListModels`
  reports `openai/gpt-4` available when `openAiApiKey` is set and unavailable
  when neither config key nor ambient `OPENAI_API_KEY` is present.
- **PL-0003** (completed): `ListModels` and `ValidateModelSelection` now restrict
  to supported providers (`local` + `openai`) via `IsSheafSupportedModel`;
  unsupported built-ins (e.g. `anthropic`) are excluded from listing and rejected
  as `model_not_found`. Test asserts the exclusion and non-selectability.

## Notes

- Test sufficiency evaluated from test artifacts and reported outcomes; reviewer
  did not run tests per policy. Implementer/polisher reported `make
  sheaf-chat-test` passing across fixes.
- The earlier human intervention request (git staging blocker for the relocated
  tests) was resolved (commit `884d7ae`) and the tests are now tracked.

No open polishing issues remain for this slice.
