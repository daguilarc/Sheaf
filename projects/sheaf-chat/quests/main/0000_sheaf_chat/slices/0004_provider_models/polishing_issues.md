# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T21:52:03Z
- updated_at: 2026-06-08T21:52:03Z
- title: Slice test suite is gitignored and not version-controlled
- details: Problem: The slice test suite under projects/sheaf-chat/tests/agents/models/ (helpers.ts, auth.test.ts, models.test.ts) is matched by the repo-root .gitignore rule "models/" (intended for ML model binaries), so the files are silently ignored by git.

Evidence:
- `git ls-files projects/sheaf-chat/tests/agents/` -> empty (nothing tracked).
- `git status --porcelain --ignored projects/sheaf-chat/tests/agents/` -> `!! projects/sheaf-chat/tests/agents/`.
- The slice source (src/agents/*) was committed in bdd89e3, but no test file under tests/agents/ is committed in any quest-step commit.

Why it is a problem:
- The slice validation requirement ("Unit tests for ...; make sheaf-chat-test") is not satisfied durably. The "51 tests pass" result exists only in this working tree.
- The tests are not under version control: they will not run in CI, will not be visible to other developers/agents, and will be lost on a clean checkout. Test coverage for this slice is effectively non-existent from the repository perspective.

Note: the physical plan Key Files names tests/agents/models/ as the location, so the implementer followed the plan; the path collides with a broad gitignore rule. The defect (untracked tests) is real regardless of intent.

What must be true to close:
- The slice test files are tracked by git (git ls-files lists auth.test.ts, models.test.ts, and the test helpers.ts).
- Achieved without weakening the intended "models/" ignore behavior for real model-artifact directories (e.g. relocate tests to a non-colliding directory name, or anchor/narrow the .gitignore rule).
- make sheaf-chat-test still discovers and passes the tests.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T21:52:15Z
- updated_at: 2026-06-08T21:52:15Z
- title: OpenAI/subscription model availability path is untested
- details: Problem: A primary slice objective is "The model registry merges OpenAI subscription/OAuth-backed models and local inference models." The OpenAI/built-in availability path is implemented but has zero test coverage.

Specifically untested:
- models.ts CreateSheafModelRegistry lines 77-80: authStorage.setRuntimeApiKey("openai", config.openAiApiKey) wiring.
- models.ts MapPiModelToMetadata non-local branch (line 107): available = modelRegistry.hasConfiguredAuth(model).
- The end-to-end behavior that a built-in OpenAI model is reported available when openAiApiKey is set and unavailable when it is not.

All existing tests in models.test.ts exercise only the local provider path. The local path is well covered; the OpenAI path is not exercised at all.

Why it is a problem:
- The OpenAI merge is a stated primary objective and is currently unverified. A regression in the openai runtime-key wiring or hasConfiguredAuth mapping would not be caught.
- "Is test coverage sufficient for changed behavior and likely failure modes?" is not met for the OpenAI half of the slice.

What must be true to close:
- A test verifies that, with config.openAiApiKey set, a built-in OpenAI model returned by ListModels has available=true.
- A test verifies that, with openAiApiKey null/unset, that same model has available=false.
- Tests use fake AuthStorage/ModelRegistry and no network (consistent with existing test style).
- resolution_notes: none

## Issue PL-0003

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T21:52:27Z
- updated_at: 2026-06-08T21:52:27Z
- title: ListModels surfaces all built-in providers, not just OpenAI + local
- details: Problem: ListModels (models.ts:129) maps modelRegistry.getAll(). Pi ModelRegistry.loadBuiltInModels uses getProviders().flatMap(getModels) (verified in node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js:298-320), so getAll() returns every built-in provider (anthropic, google, xai, etc.), not just OpenAI. ListModels therefore returns metadata for all of those providers, each marked available=false because no auth is configured for them.

The slice objective states: "The model registry merges OpenAI subscription/OAuth-backed models and local inference models." It does not call for surfacing anthropic/google/etc. models.

Why it is a problem:
- Behavior diverges from the stated objective scope. The browser-facing model list will include many providers the service does not intend to support, presented as unavailable entries.
- ValidateModelSelection will "find" those models (then reject as unavailable), implying they are selectable concepts.
- Either the divergence is intended (and should be documented + test-pinned) or unintended (and ListModels should filter to OpenAI + local). Right now it is neither documented nor tested, so the intended contract is ambiguous.

What must be true to close (either path is acceptable):
- If filtering is intended: ListModels restricts results to provider == local plus OpenAI (and any explicitly intended providers), with a test asserting non-OpenAI built-in providers (e.g. anthropic) are excluded.
- OR if surfacing all built-ins is intended: this is documented in the slice notes/spec rationale and a test asserts/acknowledges the expected set, so the contract is explicit.
- resolution_notes: none
