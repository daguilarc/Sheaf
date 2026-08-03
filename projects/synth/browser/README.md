# Synth Browser Runtime

This directory builds the Chrome-targeted static WebAssembly host for portable
`SynthApplication`s. It has no dynamic HTTP API, WebSocket service, native
helper, or server-side synth process. The catalog launcher is app-generic: the
only checked-in first-party app knowledge is the declarative
[`first-party-apps.json`](first-party-apps.json) manifest.

The catalog contract and publisher procedures are in
[docs/catalog-schema-v1.md](docs/catalog-schema-v1.md) and
[docs/publisher-guide.md](docs/publisher-guide.md).

## Runtime contract

One catalog-selection gesture creates and resumes the host `AudioContext`
before package work begins. Once the verified package module is initialized,
the generic facade registers that *same* context through the module-local
`emscriptenRegisterAudioObject` export and invokes the ABI-v3 native
`_synth_browser_start_audio_worklet` export. Native Emscripten
AudioWorklet callbacks execute the C++ `Runtime<App>::Process` path against
the instance already used for UI, MIDI, patches, and controllers.

This is callback-only audio. A package that lacks compatible context
registration or native startup fails launch with a diagnostic before audio is
reported online. There is no degraded fallback: the historical timer/ring
sample transport and its production commands are removed, and the host never
uses timer, animation-frame, message-loop, ScriptProcessor, or JavaScript
sample-ring DSP production.

Every first-party module shares `INITIAL_MEMORY=536870912`,
`ALLOW_MEMORY_GROWTH=1`, and `MAXIMUM_MEMORY=2147483648`: 512 MiB initially,
growable to 2 GiB. Application construction, persistence setup, and any needed
growth finish before native callback startup; the callback must not allocate or
grow memory.

## Browser and hosting requirements

- Use current Chrome or Chromium in a secure context. HTTPS is required in
  production; loopback is suitable locally.
- The launcher needs `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp`, and
  `Permissions-Policy: midi=(self), microphone=(self)`. Cross-origin isolation
  is required by the Emscripten worker/audio runtime. Web MIDI requests sysex
  access, and microphone capture is permitted for the launcher's own origin
  only.
- Serve `.wasm` as `application/wasm`, package JavaScript as
  `text/javascript`, and serve publisher catalog/package responses with
  `Access-Control-Allow-Origin: *`. Persistence is browser IDBFS/IndexedDB
  under `/data`.
- Browser audio exposes only `System Default` (`system_default`) for output.
  Named output selection remains unsupported; native audio input is supplied by
  the browser AudioWorklet ABI.

## Audio input and capture privacy

An application declares how many input channels it addresses through
`RuntimeConfig::numAudioInputs`. The browser host accepts 0 through 32.

- **Zero-input applications cost nothing.** Mini App and Braid 4 request no
  input. Their worklet node is created with zero input buses, and the host never
  reads `navigator.mediaDevices` or calls `getUserMedia()`, so launching them
  never shows a microphone prompt.
- **Capture is requested only from user activation.** An input-capable
  application discovers its request after its module is loaded and its runtime
  initialized, on the activation-initiated launch path, and again only when the
  user presses `Retry Input`. There is no capture on page load, no autoplay
  path, and no automatic or realtime retry loop.
- **A secure context is required.** Capture needs HTTPS or loopback plus the
  same-origin microphone `Permissions-Policy` above. A missing prerequisite is
  reported by name on the Audio page instead of re-prompting.
- **Constraints are pinned.** The host requests
  `{ audio: { channelCount: { ideal: N }, echoCancellation: false,
  noiseSuppression: false, autoGainControl: false } }`. The count is *ideal*, so
  a device that supplies fewer channels degrades to a shortfall rather than
  failing, and browser voice processing cannot silently downmix a multichannel
  interface.
- **The active count is published, not guessed.** It comes from
  `MediaStreamTrack.getSettings().channelCount`; if the browser omits that
  setting the host falls back to the source node's channel count, then to one,
  and says so with a distinct `microphone channel count unreported` status. The
  count is always clamped to the application's request.
- **The Audio page is the diagnostic surface.** For an input-capable
  application it shows one `System Default` input option and a status line that
  always leads with `Input requested N / active M`, followed by the current
  state: permission denied, capture unavailable, a secure context / permissions
  policy / launch-owned `AudioContext` prerequisite named individually, stream
  ended, unreported channel count, or input channel shortfall. `Retry Input`
  appears only while capture is offline.
- **Selection is host-neutral.** Selecting `System Default` commits the existing
  empty persisted input-device name. Browser device IDs are privacy-scoped, so
  the host neither enumerates nor persists them, and any other input option id
  is rejected.
- **Samples are realtime-only.** Captured audio reaches application DSP through
  a non-owning callback view and nothing else. It is never written to IndexedDB,
  logs, catalog metadata, or the UI command buffer, and the source is connected
  only to the native worklet input bus — there is no host-created passthrough to
  `AudioContext.destination`, so nothing is monitored unless application DSP
  writes it to output.
- **Input failure never stops output.** Denial or an ended stream clears the
  active count to zero; a channel shortfall is not a failure and keeps its `M`
  active channels, with only the missing `N - M` reading as silence. In every
  case requested-but-inactive channels read as silence and the output callback,
  UI, persistence, and MIDI keep running.
- **Unload releases capture without waiting.** A `pagehide` clears the native
  active count, disconnects the source, and stops every track before the handler
  returns, because a page being unloaded or frozen into the back/forward cache is
  not required to run any promise continuation.

## Build and test

Install dependencies and run the TypeScript, generic-boundary, Node, and
Playwright suite:

```sh
npm --prefix projects/synth/browser install
npm --prefix projects/synth/browser test
```

With `em++` available, compile every configured first-party app from the
manifest, then publish the validated Cloudflare launcher artifact:

```sh
make -C projects/synth/browser browser-apps
npm --prefix projects/synth/browser run publish:site
```

`browser-apps` emits transient binding translation units under
`dist/generated/browser-apps/`, compiles every manifest record through one
generic recipe, and atomically replaces the complete emission report. The
generated files are build artifacts, not source to edit or check in. A failing
record leaves the last complete output intact.

The first-party manifest currently contains ordinary Mini App and Braid 4
records. The publisher consumes all validated emissions, not a privileged app,
and atomically replaces `dist/site` only after verifying the complete catalog,
every declared immutable package file, and a generic rollback page for every
catalog app. `catalogVersion` is derived from the ordered complete app/build
set; it is not a per-app build ID.

## Publication roles and rollback

Cloudflare Pages is the top-level launcher host. Its artifact includes the
launcher, generic runtime modules, catalog, immutable packages, per-app
rollback pages, and `_headers` policy. Cloudflare applies COOP
(`Cross-Origin-Opener-Policy`), COEP (`Cross-Origin-Embedder-Policy`), and the
MIDI and microphone `Permissions-Policy`. GitHub Pages is publisher-only: its artifact
contains only the complete `catalogs/` tree and is fetched with CORS by the
Cloudflare launcher.

The preferred rollback is deployment-level: republish a previous known-good
Cloudflare artifact. The current artifact also has one temporary direct page
per catalog app at `rollback/apps/<app-id>/`; each page references that app's
immutable package rather than copying application-specific files. Do not
mutate a validated catalog or an older immutable package path in place.

The repository validates local artifact structure, deterministic output, and
loopback two-origin launches. It does not prove a live Cloudflare deployment or
live GitHub Pages CORS/MIME behavior locally. The Pages workflow owns that
post-deploy evidence: it validates the expected **whole catalogVersion** and
every declared package response before its deployed-origin smoke.

## GitHub Pages publisher

Enable **Settings → Pages → Build and deployment → Source → GitHub Actions**
once and keep the `github-pages` environment limited to the default branch. The
workflow does not change repository settings or deploy feature branches. Its
stable first-party catalog URL is
`https://jvictor0.github.io/Sheaf/catalogs/sheaf/catalog.json`. This documents
the configured publication contract and does not assert that a deployment is
presently live.

```sh
npm --prefix projects/synth/browser run publish:pages
```

This derives `dist/pages` from a validated `dist/site` and atomically replaces
it with catalogs and immutable packages only. The workflow then passes the
build's expected catalog version to `validate-deployed-catalog.mjs`; the
validator rejects a deployment unless its complete catalog and every declared
file are CORS-readable, correctly typed, size-matching, and SHA-256-matching.
GitHub Pages platform limits are external service constraints; consult the
[current GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
before relying on the publisher. Published-site size, deployment duration,
bandwidth, and rate limits can change independently of this repository.

Local checks cannot prove live Pages CORS or MIME behavior; only CI validates
those properties after deployment. This documentation does not claim live Cloudflare header behavior or a live Cloudflare deployment.
