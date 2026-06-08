# Issue responses

## Response PL-0001 2026-06-08T21:04:18Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Restored the shared omlx_api_key entry in config/api_keys.example.json while keeping the new local_inference_api_key entry for Sheaf Chat.

## Response PL-0002 2026-06-08T21:04:25Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Added projects/sheaf-chat/dist/ to .gitignore and removed the generated dist output from version control so build artifacts are regenerated locally instead of committed.

## Response PL-0003 2026-06-08T21:04:31Z

- issue_id: PL-0003
- outcome: Fixed
- explanation: Replaced the shell-dependent dist/tests/**/*.test.js glob with projects/sheaf-chat/scripts/run-tests.mjs, which recursively discovers compiled .test.js files and invokes node --test with an explicit sorted file list.
