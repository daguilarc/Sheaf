import { synthBrowserPlaywrightConfig } from "./projects/synth/browser/playwright.shared-config.mjs";

// This root config exists for commands such as
// `npx --prefix projects/synth/browser playwright test ...` run from the repo
// root. Preserve that command's working-directory static server path.
// Export a bare object here because the root-level Playwright config is loaded
// by the browser package's Playwright install through `--prefix`.
export default synthBrowserPlaywrightConfig({
  testDir: "./projects/synth/browser/tests",
  staticServerCommand: "node projects/synth/browser/src/static-server.mjs",
});
