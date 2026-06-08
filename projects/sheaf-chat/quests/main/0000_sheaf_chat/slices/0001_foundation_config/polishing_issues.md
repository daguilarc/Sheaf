# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T20:47:14Z
- updated_at: 2026-06-08T20:47:14Z
- title: omlx_api_key removed from shared config/api_keys.example.json
- details: ## What is wrong
The slice replaced the existing omlx_api_key entry in config/api_keys.example.json with local_inference_api_key instead of adding the new key alongside it.

## Why it is a problem
config/api_keys.example.json is a shared repo-level template. omlx_api_key is still documented and tested by the dictator service, so removing it is an out-of-scope regression that may lead operators to delete a still-required key.

## To close
Restore omlx_api_key in config/api_keys.example.json and keep local_inference_api_key as an additional Sheaf Chat key.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T20:47:27Z
- updated_at: 2026-06-08T20:47:27Z
- title: Build output projects/sheaf-chat/dist committed and not gitignored
- details: ## What is wrong
The slice commits compiled TypeScript output under projects/sheaf-chat/dist, including .js, .d.ts, and source map files. There is no projects/sheaf-chat/.gitignore, and the root .gitignore does not exclude projects/sheaf-chat/dist.

## Why it is a problem
This differs from the repo convention used by the other TypeScript projects, bloats diffs, lets committed dist drift from src, and conflicts with npm run clean producing large spurious deletions.

## To close
Stop tracking projects/sheaf-chat/dist, add an ignore rule for that build output, and keep build/test workflows generating dist locally.
- resolution_notes: none

## Issue PL-0003

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T20:47:34Z
- updated_at: 2026-06-08T20:47:34Z
- title: Test discovery glob is environment-dependent; conflicts with engines >=20
- details: ## What is wrong
projects/sheaf-chat/package.json runs tests with node --test dist/tests/**/*.test.js. npm scripts run through sh, where ** is not a portable globstar, and native node --test glob handling depends on newer Node behavior while the package declares engines.node >=20.

## Why it is a problem
On supported environments, the command can match zero files or pass a literal pattern to node. The analogous realtime-agent package avoids this with a dedicated test runner script.

## To close
Use a deterministic test discovery mechanism that works under Node 20 and POSIX sh, such as a small runner script or an explicit file list.
- resolution_notes: none
