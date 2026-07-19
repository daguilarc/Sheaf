import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  webServer: { command: "node src/static-server.mjs", port: 4173, reuseExistingServer: true },
});
