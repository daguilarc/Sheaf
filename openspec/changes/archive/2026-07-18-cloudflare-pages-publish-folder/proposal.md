## Why

The browser synth already runs as static assets, but Cloudflare Pages needs a conventional publish directory with deployment headers instead of the local Node static server. Creating that artifact makes the site easy to deploy at a custom subdomain without changing the runtime architecture.

## What Changes

- Add a browser synth publish step that assembles the static site into a deployable folder.
- Include Cloudflare-compatible `_headers` in the publish output so the deployed site preserves cross-origin isolation, Web MIDI policy, and WASM content handling.
- Keep the existing local static server for development and tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-portable-runtime-shell`: add deployable static publish artifact requirements for the browser runtime shell.

## Impact

- Affected code: `projects/synth/browser` package scripts, static publish assembly, and tests.
- Affected deployment: Cloudflare Pages can publish the generated folder and serve the browser synth with the required headers.
- No runtime API, WebSocket service, or server-side synth process is introduced.
