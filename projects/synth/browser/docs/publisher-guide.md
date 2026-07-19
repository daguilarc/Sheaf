# Publishing a browser catalog

This guide describes a separate repository publishing multiple packages for a
launcher that has already chosen to trust its catalog URL. Publisher updates do
not automatically register themselves: a launcher operator must manually add
the stable catalog URL to its trusted `catalog-sources.json` deployment.

## Immutable publisher tree

For a publisher called `example-labs`, publish this tree at one HTTPS origin:

```text
catalogs/example-labs/catalog.json
catalogs/example-labs/packages/tone-grid/<build-id>/app.js
catalogs/example-labs/packages/tone-grid/<build-id>/app.wasm
catalogs/example-labs/packages/delay-lab/<build-id>/app.js
catalogs/example-labs/packages/delay-lab/<build-id>/app.wasm
```

Each `<build-id>` is content-derived and immutable. Never replace a file in a
published build root. Publish a new root and change the stable catalog instead.
Every emitted dependency needed by an Emscripten app--including data files,
pthread/Wasm-worker, and AudioWorklet sidecars--must appear in that app's
`files` array. The current first-party build aliases its three worker/worklet
roles to the entry bootstrap; a different build may publish separate files.

Use the repository assembler where possible; it inventories bytes, calculates
SHA-256, derives the build ID, copies the immutable tree, and prints a browser
record:

```sh
node projects/synth/browser/dist/src/package-app.mjs \
  --app-id tone-grid --source-dir build/tone-grid --output-dir publish/catalogs/example-labs \
  --entry app.js --wasm app.wasm --pthread-worker app.js --wasm-worker app.js --audio-worklet app.js
```

For an independent implementation, calculate `size` from the exact emitted
bytes and use a lowercase digest, for example `wc -c < app.js` and
`shasum -a 256 app.js`. The build-ID algorithm used here hashes each sorted
inventory record's path, media type, size, and SHA-256, so use the supplied
assembler if compatibility with this publisher layout matters.

## Complete schema-v1 multi-app catalog

Replace every illustrative digest and build ID below with real content-derived
values before publishing. All paths resolve relative to `catalog.json`.

```json
{
  "schemaVersion": 1,
  "catalogVersion": "release-1",
  "publisher": { "id": "example-labs", "name": "Example Labs" },
  "apps": [
    {
      "appId": "tone-grid", "displayName": "Tone Grid", "author": "Example Labs", "category": "Instrument",
      "buildId": "tone-grid-build-1",
      "browser": {
        "abiVersion": 1, "uiProtocolVersion": 1, "runtimeConfigVersion": 1,
        "entry": "packages/tone-grid/tone-grid-build-1/app.js",
        "files": [
          { "path": "packages/tone-grid/tone-grid-build-1/app.js", "mediaType": "text/javascript", "size": 1234, "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
          { "path": "packages/tone-grid/tone-grid-build-1/app.wasm", "mediaType": "application/wasm", "size": 5678, "sha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" }
        ]
      }
    },
    {
      "appId": "delay-lab", "displayName": "Delay Lab", "author": "Example Labs", "category": "Effect",
      "buildId": "delay-lab-build-1",
      "browser": {
        "abiVersion": 1, "uiProtocolVersion": 1, "runtimeConfigVersion": 1,
        "entry": "packages/delay-lab/delay-lab-build-1/app.js",
        "files": [
          { "path": "packages/delay-lab/delay-lab-build-1/app.js", "mediaType": "text/javascript", "size": 2345, "sha256": "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" },
          { "path": "packages/delay-lab/delay-lab-build-1/app.wasm", "mediaType": "application/wasm", "size": 6789, "sha256": "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff" }
        ]
      }
    }
  ]
}
```

The example's IDs are schema-valid placeholders, but the hashes are deliberately
not usable package values. The launcher rejects a package whose fetched,
decoded bytes, MIME type, size, or SHA-256 differ from its record.

## GitHub Pages publisher workflow

Adapt [the repository workflow](../../../../.github/workflows/synth-browser-pages.yml)
for the publishing repository: pin setup actions, build package emissions, run
the local gates, make the publisher-only artifact, then upload it through the
official Pages actions. Enable **Settings → Pages → Build and deployment →
GitHub Actions** once for that repository; the workflow does not turn Pages on
for you. Its artifact must contain catalogs/packages only--no launcher,
`_headers`, or runtime modules.

Every public catalog and package response needs `Access-Control-Allow-Origin: *`.
Serve JS as `text/javascript`, WASM as `application/wasm`, and other declared
files with their exact manifest MIME type. After deployment, run the validator
against the actual catalog URL and expected build ID; it verifies CORS, MIME,
immutable-root membership, size, and SHA-256:

```sh
node projects/synth/browser/src/validate-deployed-catalog.mjs \
  --catalog-url https://example.github.io/apps/catalogs/example-labs/catalog.json \
  --expected-build-id tone-grid-build-1
```

For a local, non-deploying equivalent, build the first-party artifact and run
the two-origin/deployed-origin tests; those use loopback and prove the loader
path, not live Pages behavior:

```sh
make -C projects/synth/browser browser-fake-app browser-miniapp
npm --prefix projects/synth/browser run publish:site
npm --prefix projects/synth/browser run publish:pages
npx --prefix projects/synth/browser playwright test tests/two-origin-package.spec.ts tests/deployed-origin.spec.ts
```

To trust the publisher, the launcher operator independently adds, for example,
`https://example.github.io/apps/catalogs/example-labs/catalog.json` to its
source list. Subsequent edits to that publisher's stable catalog automatically
appear on launcher refresh/retry; adding the publisher URL itself is always a
manual host registration and grants the publisher the ability to execute code
after selection. Integrity checking is not isolation or sandboxing.
