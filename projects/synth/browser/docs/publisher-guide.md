# Publishing a browser catalog

A launcher operator separately registers a stable catalog URL in its trusted
`catalog-sources.json`. That registration is a host trust decision; publishing
or updating a catalog does not add it to launchers automatically.

## Add a first-party application

One conforming first-party application is onboarded by adding **one record** to
[`first-party-apps.json`](../first-party-apps.json). The record contains exactly
the catalog metadata and compile-time C++ identity used by the shared builder:

```json
{
  "appId": "tone-grid",
  "displayName": "Tone Grid",
  "author": "Example Labs",
  "category": "Instrument",
  "header": "ToneGrid.hpp",
  "cppType": "example::ToneGrid",
  "includeDirs": ["../apps/tone-grid"]
}
```

`appId` is lowercase kebab case; metadata strings are trimmed and nonempty;
`cppType` is a qualified C++ identifier; and header/include paths must resolve
within the allowed application source roots. Duplicate IDs, unknown fields,
missing fields, invalid identifiers, missing headers, and source-root escapes
fail before any publication artifact is produced.

Then run:

```bash
make -C projects/synth/browser browser-apps
npm --prefix projects/synth/browser run publish:site
```

The builder sorts valid records by app ID, generates a transient binding under
`dist/generated/browser-apps/` that invokes `SYNTH_BROWSER_APP(<cppType>)`, and
compiles all records through the same ABI-v3 runtime, exports, workers/worklet
policy, and memory flags. Do not add an entry `.cpp`, Make target, package
branch, deployment branch, or custom audio integration for an app.

Mini App and Braid 4 are the reference ordinary records. Both use the same
launcher path, generic runtime host, immutable package assembler, and
per-identity persistence root. Every module starts with 512 MiB, can grow to
2 GiB, and completes initialization and any required growth before native
audio starts.

## Publish atomically

The generic catalog assembler consumes the complete validated manifest and its
matching emission report. It validates every app's declared emitted artifacts,
packages each under `packages/<app-id>/<build-id>/`, and writes one ordered
catalog. The first-party `catalogVersion` hashes the complete ordered
app/build set. A compile, undeclared-file, missing-file, or package-validation
failure prevents replacement of the last complete output; it never publishes a
partial catalog.

`publish:site` stages and validates the full Cloudflare artifact before an
atomic replacement of `dist/site`. It includes launcher assets, generic runtime
modules, the complete catalog and packages, `_headers`, and exactly one direct
rollback page at `rollback/apps/<app-id>/` for each catalog record. The
rollback page references the app's immutable package; no per-app copied
browser program is required.

Use deployment rollback for recovery: republish a previous known-good
Cloudflare artifact. Do not overwrite an existing immutable package or edit a
validated catalog in place.

## Cloudflare launcher and GitHub Pages publisher

Cloudflare Pages hosts the top-level launcher and owns the COOP, COEP, and MIDI
permission headers required by the isolated runtime. GitHub Pages hosts a
publisher-only artifact created with:

```bash
npm --prefix projects/synth/browser run publish:pages
```

`dist/pages` contains only the complete `catalogs/` tree. It has no launcher,
runtime module tree, `_headers`, or rollback pages. Public catalog/package
responses need `Access-Control-Allow-Origin: *`, `text/javascript` for
JavaScript, and `application/wasm` for Wasm.

Enable GitHub Pages once in repository settings with **Build and deployment →
GitHub Actions**. The workflow builds packages, publishes the Pages artifact,
and after deployment passes the expected complete catalog version to:

```bash
node projects/synth/browser/src/validate-deployed-catalog.mjs \
  --catalog-url https://example.github.io/apps/catalogs/example-labs/catalog.json \
  --expected-catalog-version first-party-<complete-catalog-digest>
```

The validator checks the whole deployed catalog version, each declared package
file's CORS, MIME, decoded size, and SHA-256; the following CI job runs the
deployed-origin Chromium smoke. Local commands prove staged artifacts and
loopback behavior only. They do not prove live Pages CORS/MIME, live Cloudflare
headers, or that either deployment is currently live.
