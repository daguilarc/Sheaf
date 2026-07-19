## Context

The desktop SheafPatch executable constructs a vector of `SynthAppRegistration` values at compile time and launches one typed runtime session. The browser site instead names one Emscripten module in HTML, but its TypeScript runtime already accepts a module URL and adapts a fixed set of generic C exports. The completed `add-browser-wasm-runtime` change also established the constraints that matter here: the top-level page must be a secure, cross-origin-isolated static site; audio starts from a user gesture; application UI crosses the boundary as a versioned command buffer; and the app plus its Sheaf implementation are compiled into the WASM artifact.

The catalog publishers are explicitly trusted. This design therefore solves federation, compatibility, caching, and deployment, not hostile-code containment. The first publisher is this repository, and the currently published miniapp page becomes the launcher that discovers miniapp through the same externalized contract future repositories use.

GitHub Actions and GitHub Pages are useful but have distinct roles. GitHub officially supports custom Actions workflows that build arbitrary static output and deploy a Pages artifact. A live Pages response also currently supplies `Access-Control-Allow-Origin: *` and serves `.wasm` as `application/wasm`, making it suitable for public catalogs and CORS-fetched package files. Pages does not give the repository build control over COOP, COEP, or Permissions-Policy response headers, so it is not the top-level runtime host. The existing Cloudflare Pages deployment remains the launcher because its checked-in `_headers` file provides those policies.

## Goals / Non-Goals

**Goals:**

- Turn the production browser site into an application-agnostic SheafPatch launcher.
- Fetch a small, preconfigured set of trusted catalogs and merge multiple applications from each.
- Let a publisher update or add apps by rebuilding only its stable catalog/package URL.
- Preserve application/library independence by compiling each app with its chosen Sheaf implementation and stabilizing only a narrow, versioned browser boundary.
- Consume the launcher selection as the single required activation gesture for audio and MIDI.
- Publish this repository's catalog and miniapp package as the first end-to-end example.
- Prove GitHub Actions + GitHub Pages as a package publication path while retaining Cloudflare Pages for the isolated launcher.

**Non-Goals:**

- No untrusted-plugin sandbox, iframe isolation, signatures, publisher accounts, or public submission flow.
- No dynamic catalog backend, repository cloning, GitHub API discovery, or runtime compilation from source.
- No attempt to make arbitrary raw Git repository URLs loadable; publishers produce static web artifacts.
- No simultaneous applications or reliable hot switching between apps in one page lifetime. Reloading returns to the launcher.
- No promise that an app compiled against an incompatible browser ABI will run; incompatibility is diagnosed before code execution.
- No automatic migration of an application's patch schema across publisher builds.

## Decisions

### D1 — Use a static source list and federated catalogs

The launcher build contains a small `catalog-sources.json` array of stable HTTPS catalog URLs. At startup it fetches all sources concurrently using normal HTTP cache validation, validates each response independently, and renders the union of accepted apps. A failed source contributes a visible source diagnostic but does not suppress other sources.

This keeps discovery cheap and static. Adding a friend's repository requires adding its catalog URL to the trusted source list once; subsequent app additions and updates flow from that repository's catalog without another launcher change.

Alternatives considered:

- A central catalog database or API would simplify revocation and search but adds an unnecessary service and operational authority.
- Querying GitHub repositories or releases at runtime couples the launcher to one forge, introduces API/rate-limit behavior, and does not turn source files into deployable browser artifacts.

### D2 — Define one versioned catalog with immutable application builds

Catalog schema version 1 has this conceptual shape:

```json
{
  "schemaVersion": 1,
  "catalogVersion": "<publisher build or commit>",
  "publisher": { "id": "sheaf", "name": "Sheaf" },
  "apps": [{
    "appId": "miniapp",
    "displayName": "Mini App",
    "author": "Sheaf",
    "category": "synth",
    "buildId": "<immutable build id>",
    "browser": {
      "abiVersion": 1,
      "uiProtocolVersion": 1,
      "runtimeConfigVersion": 1,
      "entry": "packages/miniapp/<build-id>/miniapp.js",
      "files": [
        { "path": "packages/miniapp/<build-id>/miniapp.js", "mediaType": "text/javascript", "sha256": "..." },
        { "path": "packages/miniapp/<build-id>/miniapp.wasm", "mediaType": "application/wasm", "sha256": "..." }
      ]
    }
  }]
}
```

All relative URLs resolve against the catalog URL. Publisher and app IDs use the existing lowercase/digit/hyphen discipline. The global application identity is `<publisher-id>/<app-id>`. A later duplicate global identity cannot replace the first accepted registration: it is skipped and reported. Display order is deterministic by display name and then global ID.

`buildId` changes whenever any package file changes, and package paths are immutable under that build ID. SHA-256 values prevent a cache or partial deployment from combining files from different builds; they are consistency checks rather than a security boundary because publishers are trusted.

Alternative considered: one manifest per app. A catalog containing multiple lightweight app records matches the stated multi-app repository model and needs one fetch per publisher.

### D3 — Freeze the host ABI, not the Sheaf library

Each application package contains the concrete app, its chosen Sheaf library or fork, Emscripten runtime code, and an adapter implementing browser ABI version 1. The launcher owns JavaScript browser integration and relies only on the declared ABI, UI command-buffer version, and runtime-config version.

The ABI covers lifecycle, audio activation/processing, UI frames/actions, MIDI, persistence dirtiness, and diagnostics. The module factory must expose machine-readable version values before runtime creation. The loader rejects version mismatches before calling application lifecycle exports.

Changing DSP, application modules, parameter algorithms, or internal C++ APIs does not change this contract and does not update an existing client. A fork that intentionally changes the browser boundary must publish a new protocol version or include a compatible adapter.

Alternative considered: dynamically link apps against the launcher's current Sheaf WASM library. That would reduce package size but recreate exactly the library-version coupling this change is intended to avoid.

### D4 — Materialize trusted remote packages before instantiation

Cross-origin catalogs and package files are fetched with CORS. The loader validates the declared media types, lengths where available, and SHA-256 hashes, then creates typed object URLs for the entry, WASM, pthread/worker, AudioWorklet, and other declared sidecars. It instantiates the modularized Emscripten factory with an explicit `locateFile` map and `mainScriptUrlOrBlob`/equivalent worker bootstrap so browser same-origin worker restrictions never depend on a remote URL being directly accepted by `Worker` or `AudioWorklet`.

Object URLs live for the application session and are revoked during teardown or page unload. The implementation first proves this path with a generic fake app served from a second origin, then with a deployed GitHub Pages package. Direct remote `import()` without controlled sidecar resolution is not the production path.

Alternative considered: copy every external package into the Cloudflare launcher deployment. That avoids cross-origin loading but means a friend's update is not visible until the central launcher is rebuilt.

### D5 — Treat selection as an activation lease

The catalog list is loaded without starting audio. The app row's pointer/click handler immediately creates and resumes the host audio context and requests sysex Web MIDI access before awaiting package downloads. Those host-owned activated resources form an activation lease passed into the selected runtime as it initializes. The runtime must use the activated audio context rather than create a second context after network awaits.

The launcher then shows package progress, materializes the selected build, creates and initializes the runtime, attaches its AudioWorklet to the activated context, and replaces the launcher DOM with the generic runtime UI. Activation or permission failure is shown on the selected row and allows retry.

This requires a focused extension of the current runtime start boundary, which presently creates its Emscripten audio context inside the loaded module. It is necessary to make one launcher click reliable rather than depending on transient activation surviving a network load.

### D6 — Preserve shared runtime configuration and app-isolated patches

The global application identity supplies the SheafPatch data-path namespace. Runtime configuration remains shared under the browser SheafPatch root, while patches are rooted under `patches/<publisher-id>/<app-id>`. The browser ABI passes structured path identity rather than asking each app to invent its own root.

The runtime-config format is part of the declared compatibility boundary. An app with an unsupported runtime-config version is rejected rather than allowed to corrupt shared configuration. Application build IDs do not enter the patch path, so an updated build sees the same app's patches; patch-schema compatibility remains the publisher's responsibility.

### D7 — Keep one active application per navigation

After successful selection, the launcher is replaced by the app surface. The app may expose a reload/back-to-launcher action that performs a top-level navigation, but the first implementation does not destroy one Emscripten AudioWorklet runtime and start another in place. This matches the current runtime's conservative AudioWorklet lifetime and prevents two MIDI/audio owners from overlapping.

### D8 — Publish the launcher and first-party package together on Cloudflare Pages

The existing Cloudflare publish directory changes from `index.html + app.js` to:

```text
index.html                         launcher
catalog-sources.json               trusted catalog URLs
catalogs/sheaf/catalog.json        first-party catalog
catalogs/sheaf/packages/miniapp/
  <build-id>/...                   first-party app package
dist/src/...                       generic launcher/runtime modules
_headers                           COOP/COEP/MIDI/WASM policies
```

The first source URL resolves back to the deployed first-party catalog. The catalog's miniapp entry resolves back to the package in the same deployment. This makes production exercise the exact catalog contract without requiring GitHub Pages availability.
The package lives beside the catalog because schema v1 package paths are
normalized relative paths resolved against the catalog response URL; this keeps
the checked-in source and package references honest without a root alias or a
duplicate package copy.

### D9 — Use GitHub Actions and Pages as an additional publisher path

A GitHub Actions workflow installs Node and Emscripten, runs native/TypeScript/Playwright gates, builds immutable package files and the catalog, uploads the static Pages artifact, and deploys it through the official Pages actions. The Pages artifact contains catalogs and packages, not the top-level launcher.

Post-deploy validation fetches the catalog, asserts CORS visibility and `application/wasm`, and runs the launcher against the Pages URL in cross-origin-isolated Chromium. The workflow or documented repository setup must enable GitHub Pages with Actions as its source. A failure of the deployed-origin smoke test fails publication readiness rather than weakening the runtime's isolation requirements.

GitHub Pages is intentionally not the main launcher: its static artifact mechanism does not let this repository define the top-level COOP/COEP and MIDI response headers already provided by Cloudflare Pages.

## Risks / Trade-offs

- [A trusted catalog can execute arbitrary JavaScript with launcher privileges] → Keep catalog URLs in reviewed source control, show publisher identity, and provide no end-user URL registration in this change.
- [Package sidecars may assume same-origin URLs] → Fetch and hash every declared file, create typed object URLs, pass explicit Emscripten file/worker locators, and gate completion on two-origin and live Pages tests.
- [A click's transient activation can expire during download] → Acquire host audio/MIDI resources synchronously in the selection handler and pass them into runtime initialization.
- [Catalog caches can briefly hide a new release] → Use a stable catalog with revalidation-friendly caching and immutable `buildId` package paths; expose a manual refresh/retry action.
- [A publisher can break existing patches] → Keep patch roots stable across builds but make patch migration the publisher's responsibility and surface load errors without damaging the catalog.
- [Shared runtime config can drift across forks] → Declare and enforce `runtimeConfigVersion` alongside the ABI before the module can write shared state.
- [GitHub Pages behavior is a hosting service behavior, not a compile-time guarantee] → Retain same-origin Cloudflare first-party deployment and run a post-deploy Pages header/runtime smoke test.
- [Full per-app Sheaf builds increase download size] → Load only manifests at startup, download only the selected app, use immutable HTTP caching, and accept the size in exchange for version independence.

## Migration Plan

1. Introduce schema validation, catalog merging, package materialization, and launcher UI behind test fixtures while retaining the existing direct miniapp entry for comparison.
2. Extend the browser activation/ABI boundary and prove the generic fake app from a second origin.
3. Generate the first-party catalog and immutable miniapp package during the existing publish build.
4. Change the production `index.html` to launch the catalog browser, with the first source and package pointing back to the same Cloudflare deployment.
5. Add GitHub Actions build/deploy and enable GitHub Pages as a catalog/package mirror; run the live cross-origin smoke gate.
6. Remove the direct `dist/wasm/app.js` auto-launch assumption after launcher and miniapp acceptance tests pass.

Rollback is a static deployment rollback: republish the previous Cloudflare Pages artifact, whose direct miniapp entry remains self-contained. Catalog/package schema version 1 files are additive and require no server or user-data migration.

## Open Questions

None required before implementation. Additional trusted catalog URLs and any custom domain for the GitHub Pages mirror are deployment configuration, not architectural decisions.
