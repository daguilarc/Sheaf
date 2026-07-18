## Context

`projects/synth/browser` is a static WebAssembly host, but its local `src/static-server.mjs` supplies deployment-critical headers for cross-origin isolation and MIDI policy. Cloudflare Pages can serve the same static assets if the project produces a publish directory containing those assets plus a `_headers` file.

## Goals / Non-Goals

**Goals:**

- Produce one deterministic browser synth publish directory for Cloudflare Pages.
- Include Cloudflare Pages `_headers` rules for COOP, COEP, MIDI permissions, and WASM content type.
- Keep the existing development static server unchanged.

**Non-Goals:**

- Do not add a backend service, Worker route, or custom-domain automation.
- Do not change the browser runtime architecture or remove SharedArrayBuffer/pthread requirements.
- Do not build the Emscripten miniapp artifact inside the publish script; it must publish the artifacts already built by the existing build flow.

## Decisions

- Use `dist/site` as the publish directory.
  - Rationale: it keeps generated deployment artifacts inside the browser build output tree and out of source-controlled `public/`.
  - Alternative considered: publish directly from `public/`; rejected because the runtime also needs compiled TypeScript and WASM artifacts from `dist/`.

- Add a Node packaging script owned by `projects/synth/browser`.
  - Rationale: the package already uses Node for tests and the static server, and a script can verify required artifacts before publishing.
  - Alternative considered: shell-only copy commands; rejected because cross-platform path handling and explicit missing-artifact diagnostics are cleaner in Node.

- Add a Cloudflare Pages build script owned by `projects/synth/browser`.
  - Rationale: Cloudflare's build image does not provide `em++`, so Git-backed Pages builds must bootstrap Emscripten before running the existing Make targets.
  - Alternative considered: relying on dashboard build commands to inline the bootstrap; rejected because long dashboard commands are hard to test and easy to mistype.

- Generate `_headers` into the publish directory.
  - Rationale: Cloudflare Pages consumes `_headers` from the publish root, while the local server continues to inject equivalent headers dynamically.
  - Alternative considered: commit `_headers` under `public/`; rejected because the publish root is the contract, not the source asset root.

## Risks / Trade-offs

- Missing WASM build artifact -> the publish script fails with a clear message instead of silently deploying a broken shell.
- Hosted Git build lacks Emscripten -> the Cloudflare build script installs and activates Emscripten before invoking `make`.
- Header drift between local server and Cloudflare output -> tests assert the generated `_headers` includes the same deployment-critical policies.
- Asset path mismatch -> the publish script preserves `/dist/...` and `/public/...` URL shapes by copying the static shell and compiled runtime into a publish root layout.
