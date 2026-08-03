import { defineConfig } from "@playwright/test";
import { synthBrowserPlaywrightConfig } from "./playwright.shared-config.mjs";

export default defineConfig(synthBrowserPlaywrightConfig({
  testDir: "./tests",
  staticServerCommand: "node src/static-server.mjs",
}));
