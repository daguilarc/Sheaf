# Browser catalog schema v1

The launcher accepts only schema version `1` (`SUPPORTED_CATALOG_SCHEMA_VERSION`)
and browser ABI, UI-protocol, and runtime-config versions `1`
(`SUPPORTED_BROWSER_ABI_VERSION`, `SUPPORTED_UI_PROTOCOL_VERSION`, and
`SUPPORTED_RUNTIME_CONFIG_VERSION`). This is a strict, closed JSON contract:
every object below must contain exactly the listed fields; unknown and missing
fields are rejected before an application is presented.

## Trusted discovery

`catalog-sources.json` is a nonempty JSON array of catalog URL strings. It is
configured by the launcher deployment, so registering a URL is a trust decision:
a publisher whose catalog is accepted can supply browser code that will execute
after the user selects it. A source must be HTTPS, except that loopback HTTP
(`127.0.0.1`, `localhost`, or `[::1]`) is allowed only for local browser tests;
credentials and fragments are rejected. A relative source is allowed only when
resolved against the fetched source-list URL, which is how a same-deployment
list such as `catalogs/sheaf/catalog.json` works.

The launcher fetches the list, then every registered catalog concurrently. A
failed source becomes an independent `network-error` or `incompatible`
diagnostic; healthy source apps remain available. Normal startup uses the
browser's default cache mode and **Retry catalogs** uses `no-cache`, so a stable
source URL can reveal a changed catalog without changing its registration.

## Catalog JSON

```json
{
  "schemaVersion": 1,
  "catalogVersion": "release-2026-07-19",
  "publisher": { "id": "example-labs", "name": "Example Labs" },
  "apps": [
    {
      "appId": "tone-grid",
      "displayName": "Tone Grid",
      "author": "Example Labs",
      "category": "Instrument",
      "buildId": "a-content-derived-immutable-id",
      "browser": {
        "abiVersion": 1,
        "uiProtocolVersion": 1,
        "runtimeConfigVersion": 1,
        "entry": "packages/tone-grid/a-content-derived-immutable-id/app.js",
        "files": [
          {
            "path": "packages/tone-grid/a-content-derived-immutable-id/app.js",
            "mediaType": "text/javascript",
            "size": 1234,
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          }
        ]
      }
    }
  ]
}
```

`catalogVersion` is a trimmed 1--128-character string. `publisher.id`,
`appId`, and `buildId` are 1--200-character lowercase ASCII identifiers:
letters or digits separated only by single hyphens. `publisher.name`,
`displayName`, `author`, and `category` are trimmed, nonempty strings of at
most 200 characters. `apps` is nonempty and may contain multiple apps, but
their local `appId` values must be unique. `buildId` identifies an immutable
build; it is not a mutable release label.

`browser` has exactly `abiVersion`, `uiProtocolVersion`,
`runtimeConfigVersion`, `entry`, and `files`. Each version must exactly match
the supported host value. `entry` and every file `path` are normalized relative
paths: no slash prefix, traversal, empty segments, backslashes, percent escapes,
query/fragment, or colon. They resolve relative to the **catalog response URL**,
not the launcher page. `files` is nonempty, has unique paths, and each record
has exactly these fields:

| Field | Required value |
| --- | --- |
| `path` | normalized catalog-relative package path |
| `mediaType` | `text/javascript`, `application/wasm`, or `application/octet-stream` |
| `size` | nonnegative safe-integer decoded byte count |
| `sha256` | 64 lowercase hexadecimal SHA-256 digest of those decoded bytes |

`entry` must equal one declared file path whose media type is
`text/javascript`. File records contain no role property. Roles are assembler
inputs (`entry`, `wasm`, `pthreadWorker`, `wasmWorker`, `audioWorklet`) and each
must reference a declared emitted file; several roles may intentionally alias
one file, as the current Emscripten `miniapp.js` bootstrap does. The full file
inventory, including sidecars and data files, is authoritative.

## Registry, compatibility, and persistence

An app's global identity is `<publisher-id>/<app-id>`. Catalogs are processed
in configured source order; the first accepted registration for a duplicate
global identity wins and later copies become `duplicate-app` diagnostics.
Accepted apps are displayed in deterministic code-unit order by `displayName`,
then global identity. Different publishers may use the same local app ID.

The browser package embeds its concrete application and selected Sheaf library
or fork. The host negotiates only the stable ABI, UI command-buffer, and
runtime-config boundary; it never silently relinks or upgrades an older package
when host Sheaf changes. Version mismatch is rejected before module execution.
Shared runtime configuration is host-owned, while app patches use
`patches/<publisher-id>/<app-id>`. That root is stable across compatible
`buildId` changes and isolates publishers from one another.

## Immutable package loading

The package root is `packages/<app-id>/<buildId>/`; every listed file and entry
must be inside it. Package URLs are content-addressed by build ID and should be
published as immutable. The loader CORS-fetches each declared file with omitted
credentials, requires its response MIME essence to equal `mediaType`, then
checks decoded `arrayBuffer()` size and SHA-256. Transfer `Content-Length` is
only advisory because transfer encoding may be compressed.

After all verification succeeds, the loader creates typed object URLs for every
file. It maps the entry module, main script, WASM, pthread worker, Wasm worker,
and AudioWorklet sidecars through the explicit Emscripten `locateFile` mapping;
verified `new URL(..., import.meta.url)` sidecars are rewritten to those URLs.
This avoids document-relative or direct cross-origin Worker/AudioWorklet loads.
Object URLs remain alive for the selected app and are revoked exactly once on
disposal. Integrity proves bytes only: it is not a code sandbox.

Only one app is active per navigation. Selection begins host-owned audio and
sysex MIDI activation in that user gesture, before package work; returning to
the launcher is a top-level navigation/reload that releases the prior audio and
MIDI ownership. The running runtime owns the root after selection, so the
launcher does not render an in-page return control into that runtime surface.

## Updates and operating limits

Keep catalog URLs stable and retryable; update their JSON to list a new app or
build, never alter an old package root. Startup fetches only source-list and
catalog metadata, not package bytes. A catalog update can therefore reveal a
new compatible app/build without rebuilding launcher JavaScript.

The Cloudflare publication is the cross-origin-isolated launcher and first-party
publisher: it owns COOP, COEP, and Web MIDI headers. GitHub Pages is a
publisher-only catalog/package origin. It must send `Access-Control-Allow-Origin: *`,
`text/javascript` for JS, and `application/wasm` for WASM; its post-deploy
validator and Chromium smoke are CI evidence, not a claim that either site is
currently live. Audio and MIDI remain host-owned. The operational rollback
boundary is republishing a known-good validated launcher artifact; immutable
package paths are not rewritten in place.
