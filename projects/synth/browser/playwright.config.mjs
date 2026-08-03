import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  // AudioWorklet and native-deadline assertions share fixed loopback ports and
  // browser audio resources; keep the whole browser suite serialized.
  workers: 1,
  webServer: { command: "node src/static-server.mjs", port: 4173, reuseExistingServer: true },
});
