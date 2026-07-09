import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: { command: "node tests/static-server.mjs", port: 4173, reuseExistingServer: true },
});
