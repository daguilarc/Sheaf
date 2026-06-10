# Operations

Normative procedures to build, run, and test Sheaf Chat from a fresh
checkout. Design context: [architecture.md](architecture.md). Repository-wide
test lane rules: [structure/testing.md](../../../structure/testing.md).

All commands run from the Sheaf repository root unless noted. The project
directory is `projects/sheaf-chat/`.

## Prerequisites

- Node.js >= 20 (`package.json` `engines`) with `npm` on `PATH`.
- No other system dependencies. Runtime dependencies
  (`@earendil-works/pi-coding-agent`, `typebox`, `ws`, `markdown-it`,
  `katex`) and dev dependencies (`typescript`, `ajv`, type packages) are
  installed by `npm install`.

## Make targets

Project Makefile (`projects/sheaf-chat/Makefile`):

| Target | Effect |
| --- | --- |
| `all` | `install` then `test`. |
| `install` | `npm install`. |
| `build` | `npm run build` (`tsc` — compiles `src/` and `tests/` to `dist/`). |
| `test` | `npm test` (`npm run build && node scripts/run-tests.mjs`). |
| `run` | `npm run start` (`node dist/src/server/main.js`). |
| `clean` | `npm run clean` (`rm -rf dist node_modules`). |

Root Makefile delegates:

| Target | Effect |
| --- | --- |
| `make sheaf-chat-build` | `make -C projects/sheaf-chat build` |
| `make sheaf-chat-test` | `make -C projects/sheaf-chat test` |
| `make sheaf-chat-run` | `make -C projects/sheaf-chat run` |
| `make sheaf-chat-clean` | `make -C projects/sheaf-chat clean` |

## Build

```bash
cd projects/sheaf-chat
make install   # first time only
make build
```

`build` runs `tsc` per `tsconfig.json` (target ES2022, NodeNext modules,
strict) into `dist/`. `run` and `test` use compiled output; rebuild after
source changes.

## Tests

```bash
make sheaf-chat-test
# or: cd projects/sheaf-chat && make test
```

`npm test` rebuilds, then `scripts/run-tests.mjs` recursively collects every
`dist/tests/**/*.test.js`, sorts them, and runs them in one
`node --test` invocation. It exits 1 if no compiled test files are found.
There is no separate integration lane; everything (REST/WebSocket servers on
ephemeral ports, temp data dirs, fake Pi sessions) runs in this lane.

Run a single compiled test file:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/server/websocket/protocol.test.js
node --test dist/tests/server/rest/files.test.js
node --test dist/tests/ui/chatScreen.test.js
node --test dist/tests/integration/fileServer.integration.test.js
```

The shared AGUI renderer used by the chat screen is tested in
`projects/web/tests/agui-chat.test.mjs` (outside this project).

## Run the service

```bash
make sheaf-chat-build
make sheaf-chat-run
```

The entry point (`dist/src/server/main.js`) discovers the repository root,
loads config, reads `config/services.json`, and binds to the `sheaf-chat`
entry's host and port. Startup fails with
`sheaf-chat is not registered in config/services.json` if the entry is
missing. On success it logs `Sheaf Chat listening on <host>:<port>` to
stderr. Current registration: host `0.0.0.0`, port `9004`, `home_path` `/`,
command `make sheaf-chat-run` (see
[Services](../../../structure/services.md)).

Open `http://localhost:9004/` for the piles screen.

Verify:

```bash
curl -s http://localhost:9004/health       # {"healthy":true,"uptime":...}
curl -s http://localhost:9004/api/health   # service/version/dependency status
```

There is no shutdown endpoint; stop the process directly.

## Configuration

See [service](capabilities/service.md) for the normative key list and
defaults, and [Configuration](../../../structure/configuration.md) for
repository-wide rules. Summary:

- `config/global_config.json` — `local_inference_url`,
  `agent_idle_offload_seconds` (default 300).
- `config/api_keys.json` (optional, operator-created) —
  `local_inference_api_key`, `openai_api_key`.
- Both files may be absent; the service starts regardless. Missing local
  inference config only makes local models unavailable.

Environment variables:

| Variable | Effect |
| --- | --- |
| `SHEAF_CHAT_PROFILE_STREAM=1` | Emit JSON stream-profiling lines on stderr (`src/server/streamProfiler.ts`). Off otherwise. |
| `SHEAF_CHAT_ROOT` | Session root used only by the standalone extension entry point (`src/extensions/sheaf-chat/index.ts` default export); unused by the service, which binds tools per session. |

## Runtime data

All runtime state lives under `data/sheaf-chat/` (sessions, Pi agent
auth/model files); format in [session files](contracts/session-files.md).
Deleting a session's four files removes the session. The service writes no
log files; stdout/stderr handling follows
[Logs And Data](../../../structure/logs-and-data.md).
