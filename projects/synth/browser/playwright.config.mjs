import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  webServer: { command: "node src/static-server.mjs", port: 4173, reuseExistingServer: true },
});
