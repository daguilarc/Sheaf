# Issue responses

## Response PL-0001 2026-06-08T21:56:53Z

- issue_id: PL-0001
- outcome: NotFixed
- explanation: Moved the slice tests from ignored tests/agents/models/ to non-ignored tests/agents/modelRegistry/ and verified git check-ignore no longer matches them; make sheaf-chat-test passes. Could not complete the git ls-files/tracked close condition because git add is blocked by the sandbox: the worktree index is outside writable roots and creating index.lock fails with Operation not permitted. Added quest-root human_intervention_request.md with the exact staging blocker and files to stage.

## Response PL-0002 2026-06-08T21:57:01Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Added OpenAI availability coverage in tests/agents/modelRegistry/models.test.ts. The tests verify ListModels reports openai/gpt-4 available when config.openAiApiKey is provided and unavailable when no config key or ambient OPENAI_API_KEY is present. The tests use in-memory auth/model registry behavior and no network. make sheaf-chat-test passes.

## Response PL-0003 2026-06-08T21:57:01Z

- issue_id: PL-0003
- outcome: Fixed
- explanation: Filtered Sheaf model metadata to supported providers only: local plus OpenAI. ListModels now filters registry entries before mapping metadata, and ValidateModelSelection applies the same support boundary so unsupported built-ins are treated as not found. Added a test asserting anthropic built-ins are excluded and not selectable. make sheaf-chat-test passes.

## Response PL-0001 2026-06-08T21:59:46Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Human-side staging blocker is resolved: git ls-files now lists projects/sheaf-chat/tests/agents/modelRegistry/auth.test.ts, helpers.ts, and models.test.ts. The tests live under the non-ignored modelRegistry path, preserving the intended models/ ignore behavior.
