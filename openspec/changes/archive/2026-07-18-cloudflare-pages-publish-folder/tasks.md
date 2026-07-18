## 1. Publish Script

- [x] 1.1 Add a failing test that verifies the Cloudflare Pages publish artifact layout, required headers, and missing-WASM failure.
- [x] 1.2 Implement a browser publish script and package command that assembles `dist/site`.
- [x] 1.3 Add a Cloudflare Pages Git build command that bootstraps Emscripten before publishing.

## 2. Verification

- [x] 2.1 Run the targeted browser package tests for the publish artifact and confirm the publish command produces the expected directory.
