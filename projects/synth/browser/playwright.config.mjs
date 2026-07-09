import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: { command: "node src/static-server.mjs", port: 4173, reuseExistingServer: true },
});
