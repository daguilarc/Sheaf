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
- Serve `.wasm` files as `application/wasm` and package JavaScript, including
  worker and worklet sidecars, as `text/javascript`. All browser runtime files
  are static assets; persistence remains in browser IDBFS/IndexedDB storage
  under `/data`.
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

## First-Party Catalog Publication

Build the generic acceptance app and real miniapp, then assemble the exact
Cloudflare Pages directory:

```sh
make -C projects/synth/browser browser-fake-app browser-miniapp
npm --prefix projects/synth/browser run publish:site
```

`dist/site` is replaced only after a staging tree passes reference, declared
size, media-type, and SHA-256 validation. Repeating the command with identical
inputs produces a byte-identical tree:

```text
index.html
catalog-sources.json
catalogs/sheaf/catalog.json
catalogs/sheaf/packages/miniapp/<content-build-id>/miniapp.js
catalogs/sheaf/packages/miniapp/<content-build-id>/miniapp.wasm
dist/src/
rollback/direct-miniapp/
_headers
```

The checked-in source list uses `catalogs/sheaf/catalog.json`, resolved against
the deployed source-list URL. The catalog's `packages/...` records therefore
resolve beside that catalog. The generated package declares entry, WASM,
pthread worker, Wasm-worker, and AudioWorklet roles through the generic
assembler. The current Emscripten emission has two physical files: the three
worker/worklet roles deliberately alias the hashed `miniapp.js` bootstrap.

Production `index.html` is launcher-only. Startup downloads the source list and
catalog metadata, but no package bytes. Selecting `sheaf/miniapp` downloads and
verifies the immutable package through the same generic loader used for remote
publishers. Launcher/runtime source contains no miniapp branch and has no
dependency on the rollback directory or `dist/wasm/app.js`.

The `_headers` file applies COOP, COEP, and the MIDI permission policy to every
route. Additional catalog-package and rollback globs explicitly preserve WASM
and JavaScript media types for entry, pthread/Wasm-worker, and AudioWorklet
paths.

## GitHub Pages Catalog Publisher

The one-time repository setup is intentionally manual: in GitHub repository
**Settings → Pages**, set **Build and deployment → Source** to **GitHub
Actions**. Keep the `github-pages` environment limited to the default branch.
The workflow does not enable Pages, change repository settings, or deploy from
feature branches.

Once repository Pages is enabled, the stable first-party catalog URL is:

```text
https://jvictor0.github.io/Sheaf/catalogs/sheaf/catalog.json
```

This URL documents the configured publication contract; it is not a claim that
the deployment is currently live. `.github/workflows/synth-browser-pages.yml`
builds and validates the existing Cloudflare artifact, derives `dist/pages`
from it, and uploads catalogs and immutable packages only. The Pages artifact
has no root launcher, `catalog-sources.json`, rollback page, runtime module
tree, or Cloudflare-only `_headers` file. A publisher update changes the stable
catalog's build record and adds a content-addressed package directory; it never
mutates an older package directory.

GitHub Pages also imposes platform quotas that this workflow does not bypass.
Consult the [current GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
before relying on the publisher: published-site size, deployment duration,
bandwidth, and rate limits are external service constraints and can change
independently of this repository.

Every public catalog and package response must remain readable with
`Access-Control-Allow-Origin: *`. Catalog file records declare the exact byte
size, media type, and SHA-256 digest. Live JavaScript responses must use
`text/javascript`, and live `.wasm` responses must use `application/wasm`.
After deployment, the workflow passes the catalog URL and build ID explicitly
to the validator, then runs the opt-in Chromium smoke with
`SYNTH_BROWSER_REMOTE_CATALOG_URL` and `SYNTH_BROWSER_EXPECTED_BUILD_ID`.

GitHub Pages remains a publisher origin, not the top-level runtime host. The
Cloudflare site remains the launcher because its `_headers` contract supplies
COOP (`Cross-Origin-Opener-Policy`), COEP
(`Cross-Origin-Embedder-Policy`), and the Web MIDI `Permissions-Policy` needed
by the cross-origin-isolated audio runtime. A Pages package is fetched with
CORS and materialized by that isolated launcher.

Local tests prove deterministic artifact contents, validator rejection paths,
and a production-like two-origin launch. Local tests cannot prove live Pages
CORS or MIME behavior; those live properties are proven only when CI validates
the newly deployed Pages URL. This task also does not claim any live Cloudflare
header behavior or a live deployment on either host.

### Temporary Direct Rollback

`dist/wasm/app.js` is only an input to the documented rollback bundle. The
published `rollback/direct-miniapp/` contains `index.html`, `app.js`, the real
`miniapp.js` worker/worklet bootstrap, and `miniapp.wasm`; no normal production
asset references it.

The preferred rollback is to republish the previous known-good Cloudflare
Pages artifact. For a temporary direct rollback from the current artifact,
make a copy of `dist/site`, replace that copy's root `index.html` with
`rollback/direct-miniapp/index.html`, and copy the three rollback JS/WASM files
to the copy's root before publishing the copy. Do not edit or overwrite the
validated catalog artifact in place. Return to the launcher by republishing the
unchanged validated `dist/site` output.
