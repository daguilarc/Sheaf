## Context

Dictator already loads `config/dictator.json` into `RuntimeConfigFile`, resolves prompt bodies per request, and sends those prompt bodies to the selected OpenAI or Ollama refinement engine. The web dashboard edits selected runtime config fields through `/api/config`, while the dictation pipeline and launchpad flows share the same refiner request and prompt-building paths.

Injectable rules are a small but cross-cutting data model addition: the rules live in config, point at prompt catalog files, are edited from the web UI, and influence prompt assembly at refinement time. They must not alter the raw Whisper transcript, the refinement input, interaction history transcript fields, or selected-text/context block behavior.

## Goals / Non-Goals

**Goals:**

- Store injectable rules as a JSON object in `config/dictator.json`, mapping trigger strings to prompt file paths relative to `system_prompts_dir`.
- Evaluate rules for each refinement request using case-insensitive simple string matching against the raw Whisper output.
- Resolve matched prompt files through the prompt catalog and append their contents to the end of the system prompt used by the selected refinement provider.
- Expose rule viewing, addition, and deletion in the Dictator web dashboard.
- Keep the existing dictation transcript and refinement input construction semantics intact.

**Non-Goals:**

- No regex, tokenization, stemming, whole-word matching, or language-aware matching.
- No modification, deletion, or replacement of transcript text.
- No per-client rule storage; the rule set is global runtime config.
- No inline instruction blobs stored directly in `config/dictator.json`.
- No changes to OpenAI or Ollama provider APIs beyond the prompt text they receive.

## Decisions

1. Store rules under `injectable_rules` in `RuntimeConfigFile`.

   Rationale: the user requested a JSON sub-object in config, and runtime config is already the source of truth for refiner prompt behavior. The field should decode missing values as an empty object and persist as a pretty-printed sorted-key JSON object with the rest of the config. Values are prompt file paths, not instruction bodies, so config remains compact and the existing prompt catalog remains the source of longer text.

   Alternative considered: store rules in a separate file under `data/dictator`. That would avoid expanding config, but it would split prompt configuration across files and make reset/default behavior less obvious.

2. Apply resolved prompt file contents to the system prompt, not the refinement input.

   Rationale: the feature is explicitly prompt injection. The matching source is the raw Whisper transcript, but matched values are resolved as prompt files whose contents become extra prompt instructions after the selected prompt body. `RefineRequest.transcript`, optional context, selected-text transforms, and structured context blocks remain unchanged.

   Alternative considered: append matched prompt file contents to `RefinementPromptBuilder.buildInput`. That would be simpler for provider engines, but it would mix instruction text with user content and violate the requested boundary.

3. Resolve injectable prompt text before provider routing creates the provider-specific engine.

   Rationale: `ProviderRoutingRefinementEngine` and `RuntimeConfigRefinementEngine` already sit at the point where current runtime config and prompt body selection are known. Applying injection there lets both OpenAI and Ollama receive identical effective prompt text and keeps provider engine code focused on HTTP calls.

   Alternative considered: duplicate matching inside `OpenAIRefinementEngine` and `OllamaRefinementEngine`. That would invite drift and make fallback behavior harder to reason about.

4. Match keys with case-insensitive substring search and validate values against the prompt catalog.

   Rationale: this directly matches the requested "simple string matching" behavior. Empty or all-whitespace keys cannot match meaningfully and should be rejected by config updates. Values should be sanitized relative prompt file paths, rejected if blank, absolute, escaping, unknown, or empty, using the same catalog constraints as system prompt selection.

   Alternative considered: allow arbitrary relative paths and defer load failures to refinement time. That makes the UI and runtime behavior less clear, so the first implementation should validate paths when rules are edited.

5. Expose a dedicated injectable-rules API and UI section.

   Rationale: `/api/config` currently models scalar typed fields with picker support. Rules are an editable object/list with add and delete actions plus prompt-file choices, so a dedicated route keeps the existing config form contract narrow and lets the browser render a table/list with a plus button and per-row delete buttons.

   Alternative considered: add the object to `/api/config` as a new editable field. That would require teaching the generic config form about object editing and would make the existing field/options shape less coherent.

## Risks / Trade-offs

- [Risk] Matching common keys can over-apply instructions across broad dictations. -> Mitigation: keep matching behavior visible in the UI and document that keys are simple case-insensitive substrings.
- [Risk] Prompt growth from many matches can increase latency or provider token use. -> Mitigation: append only matched prompt file contents and preserve an empty-object default; tests should cover multiple matches but avoid adding hard caps unless usage shows a need.
- [Risk] JSON object ordering is not semantically meaningful. -> Mitigation: render and apply matches in stable case-insensitive key order for deterministic prompts and tests.
- [Risk] Prompt injection file contents could conflict with the base prompt. -> Mitigation: append them in a clearly delimited "Injectable rules" block at the end with the source file path so their source and precedence are inspectable.
- [Risk] A configured prompt file can be deleted after rule validation. -> Mitigation: skip unreadable or missing injectable prompt files for that request with trace logging rather than failing unrelated dictation.

## Migration Plan

- Decode missing `injectable_rules` as `{}` so existing configs continue to load.
- Add the key to bootstrap defaults and `config/dictator.safe` only if those files are touched by implementation; otherwise runtime defaults supply the empty object.
- Update `projects/dictator/docs/contracts/config.md` and the config worked example.
- Existing configs roll back safely because removing the key restores the empty-rule behavior.

## Open Questions

- None for the initial implementation.
