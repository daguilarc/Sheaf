export function synthBrowserPlaywrightConfig({ testDir, staticServerCommand }) {
  return {
    testDir,
    testMatch: "**/*.spec.ts",
    // AudioWorklet and native-deadline assertions share fixed loopback ports and
    // browser audio resources; keep the whole browser suite serialized.
    workers: 1,
    webServer: {
      command: staticServerCommand,
      port: 4173,
      reuseExistingServer: true,
    },
  };
}
