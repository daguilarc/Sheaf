## 1. Runtime Config Model

- [x] 1.1 Add `injectable_rules` to `RuntimeConfigFile` with an empty-object default and missing-key decode compatibility.
- [x] 1.2 Add config patch support for adding/replacing and deleting injectable rule entries, including rejection of blank keys and invalid prompt file paths.
- [x] 1.3 Update config persistence/default docs and worked examples to include the new `injectable_rules` object.

## 2. Prompt Injection Runtime

- [x] 2.1 Add a shared injectable-rules prompt builder that matches keys case-insensitively against the raw Whisper transcript using substring matching.
- [x] 2.2 Resolve matched values as prompt files relative to `system_prompts_dir` and append their contents to the selected system prompt in a delimited block using stable case-insensitive key order.
- [x] 2.3 Wire the effective prompt into the shared refinement routing path so OpenAI, Ollama, fallback, HTTP dictation, and launchpad refinement all use the same behavior without changing `RefineRequest.transcript` or refinement input construction.

## 3. Web API and UI

- [x] 3.1 Add dedicated web API routing/models/service handlers to list, add or replace, and delete injectable rules from runtime config with prompt-catalog validation.
- [x] 3.2 Add a dashboard section or tab that renders all stored trigger-to-prompt-file pairs, provides trigger and prompt-file controls with a plus button, and includes a delete button for each pair.
- [x] 3.3 Surface validation and persistence errors in the injectable-rules UI without clearing the currently rendered list.

## 4. Tests and Verification

- [x] 4.1 Add runtime config tests for missing-key decode, JSON persistence, add/replace, delete, and invalid prompt-file rule edits.
- [x] 4.2 Add prompt injection tests covering case-insensitive matching, non-matches, prompt-file content loading, missing-file skips, multiple-match ordering, and preservation of transcript/input data.
- [x] 4.3 Add web API tests for listing, adding/replacing, deleting, and rejecting invalid injectable rule prompt paths.
- [x] 4.4 Add static web UI tests or source assertions covering the plus control, delete controls, and implemented API references.
- [x] 4.5 Run `make -C projects/dictator test` or the focused Swift test targets that cover the changed Dictator core/service surfaces.
