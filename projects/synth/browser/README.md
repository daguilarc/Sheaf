# Synth Browser Runtime

This directory builds and tests the Chrome-targeted static WebAssembly host for
portable synth applications. It has no dynamic HTTP API, WebSocket service,
native helper, or server-side synth process.

## Browser And Hosting Requirements

- Use a current Chrome or Chromium release in a secure context. Production
  deployments require HTTPS; loopback origins are suitable for local testing.
- Serve the page with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Cross-origin isolation is
  mandatory for the `SharedArrayBuffer` audio bridge.
- Allow MIDI for the site with `Permissions-Policy: midi=(self)`. The runtime
  requests Web MIDI using `{ sysex: true }`, so the user must grant sysex
  access before MIDI ports can come online.
- Serve `.wasm` files as `application/wasm`. All browser runtime files are
  static assets under `public/` and `dist/`; persistence remains in browser
  IDBFS/IndexedDB storage under `/data`.
- The browser audio catalog exposes only `System Default` (`system_default`).
  Named output selection and `AudioContext.setSinkId()` are intentionally not
  used. Audio input is unsupported and remains skipped.

These are static-only hosting requirements. Normal audio, MIDI, UI, patch, and
configuration flows must not call application endpoints or open WebSockets.

## Build And Test

Install the browser package dependencies, then run the complete TypeScript,
generic-boundary, unit, and Playwright suite:

```sh
npm --prefix projects/synth/browser install
npm --prefix projects/synth/browser test
```

The Playwright suite always runs the generic fake-app acceptance gate before
the miniapp smoke path. Without Emscripten, the deterministic facade and
injectable-port coverage runs and the real-WASM miniapp test is reported as
skipped.

With `em++` available, build and run the real static artifacts through Make:

```sh
make -C projects/synth browser-fake-app-test
make -C projects/synth browser-miniapp-smoke
```

The smoke target builds `dist/wasm/miniapp.js` solely from
`cpp/miniapp_entry.cpp` plus the generic browser runtime sources. Its fake-app
build/test prerequisite must succeed before the miniapp artifact is built and
opened.
