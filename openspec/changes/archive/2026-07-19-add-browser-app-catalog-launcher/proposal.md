## Why

The browser runtime currently publishes one preselected application even though SheafPatch already models a launcher and the browser host can load an application module by URL. Turning the published browser site into a catalog-backed SheafPatch launcher lets trusted repositories publish new or updated synth applications without rebuilding the launcher around each concrete app.

## What Changes

- Replace the browser site's auto-launched miniapp with a SheafPatch launcher that cheaply fetches a preconfigured list of trusted catalog manifests and lists every compatible application they expose.
- Define a versioned, static JSON catalog/package contract with publisher metadata, globally stable application identity, display metadata, browser ABI/protocol versions, entry module and sidecar locations, and cache/version information; one catalog may expose multiple applications.
- Add a first-party catalog package to this repository and publish it with the site. Its initial application is the existing miniapp browser build, proving that the launcher has no concrete miniapp knowledge.
- Make application selection the required user gesture: the launcher immediately unlocks host-owned audio and MIDI permission work, loads the selected package, creates the app runtime, and replaces the launcher surface with the running app.
- Treat every configured catalog publisher as trusted code. Loaded JavaScript/WASM executes under the browser host contract without an untrusted-plugin sandbox.
- Version the narrow JavaScript-to-application browser ABI and UI command-buffer protocol while allowing each application artifact to embed the Sheaf library or fork with which it was compiled; DSP and library implementation changes do not automatically update published applications.
- Add catalog failure isolation, compatibility diagnostics, duplicate-identity handling, loading/error UI, and app-scoped browser persistence so one unavailable or incompatible catalog/app does not prevent other apps from launching.
- Add GitHub Actions CI that builds and tests the launcher plus first-party catalog/package, and publish a GitHub Pages-compatible catalog/package artifact. Keep the runnable launcher on the existing Cloudflare Pages path because it can supply required COOP/COEP and Permissions-Policy headers; allow GitHub Pages to serve trusted cross-origin catalogs and package assets through CORS, with browser tests covering remote sidecar materialization.

## Capabilities

### New Capabilities

- `synth-browser-app-catalog`: Trusted catalog discovery, versioned browser application packages, launcher selection/activation, compatibility and failure behavior, multi-repository distribution, and GitHub Pages package publication.

### Modified Capabilities

- `synth-portable-runtime-shell`: Change the production browser publish artifact from a single preselected application page into the catalog-backed SheafPatch launcher while retaining the existing Cloudflare Pages security-header contract.

## Impact

- Affected code: `projects/synth/browser` launcher/runtime TypeScript, HTML/CSS, package/publish scripts, browser tests, and the generic browser module loader; first-party catalog/package metadata under the synth browser project; GitHub Actions workflow configuration.
- Contracts: a new JSON catalog/package schema and explicit browser ABI/protocol compatibility fields around the existing generic C exports and command-buffer format.
- Deployment: the existing Cloudflare Pages URL becomes the launcher and also serves the first-party catalog/package; GitHub Actions produces and tests static distribution artifacts, with GitHub Pages supported as a CORS-enabled catalog/package origin rather than the cross-origin-isolated top-level launcher.
- Existing applications: miniapp becomes the first catalog entry and remains compiled with its current Sheaf implementation. Future trusted repositories may publish multiple independently versioned apps without being linked into the SheafPatch site build.
- Dependencies: builds continue to use Emscripten and Playwright. No application backend, dynamic catalog service, account system, signing service, or untrusted-code sandbox is introduced.
