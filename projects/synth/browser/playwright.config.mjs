import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: {
    command: "python3 -m http.server 4173 --directory .",
    port: 4173,
    reuseExistingServer: true,
  },
});
