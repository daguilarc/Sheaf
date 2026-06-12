# Operations

Normative procedures for the web project from a fresh checkout. All commands
run from the Sheaf repository root. Repository-wide test lane rules:
[structure/testing.md](../../../structure/testing.md).

## Prerequisites

- Node.js with `node:test` support (Node 18+) on `PATH` as `node` — only for
  the chat-widget tests. No `npm install`; there is no `package.json`.
- Nothing else. The assets are plain files; there is no build output.

## Build

```bash
make -C projects/web build
```

This only asserts that `src/sheaf.css` exists (`test -f`); there is nothing
to compile.

## Tests

```bash
make -C projects/web test        # or, from the repo root: make web-test
```

The Makefile `test` target is currently the same existence check as `build`
— it does **not** run the JavaScript test suite. The real test lane for the
chat widget is run directly:

```bash
node --test projects/web/tests/agui-chat.test.mjs
```

This exercises `src/agui-chat.js` (reducer, renderer, socket lifecycle,
scroll, markdown escaping) inside a `node:vm` context with a fake DOM — no
browser or dependencies required. This gap between `make test` and the real
suite is tracked in [coverage.md](coverage.md).

## Make targets

| Target | Effect |
| --- | --- |
| `all` | `build` then `test`. |
| `build` | `test -f src/sheaf.css`. |
| `test` | `test -f src/sheaf.css` (does not run the Node tests). |
| `clean` | No-op. |

Root Makefile delegates: `make web-build`, `make web-test`, `make web-clean`.

## Run / deploy

There is nothing to run. The project ships static files; each consuming
service serves `projects/web/src/` from its own repository checkout at
`/assets/web/<filename>` (consumer list and code pointers:
[web-utilities — Interactions](../../../openspec/specs/web-utilities/spec.md#interactions)).
Changes to files under `src/` are picked up by consumers on the next HTTP
request (quest-runner serves them with caching disabled).
