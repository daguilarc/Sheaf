export default {
  testDir: "./projects/synth/browser/tests",
  testMatch: "**/*.spec.ts",
  // This root config exists for commands such as
  // `npx --prefix projects/synth/browser playwright test ...` run from the repo
  // root. The audio/deadline specs use fixed loopback ports and browser audio
  // resources, so they must remain globally serialized.
  workers: 1,
  webServer: {
    command: "node projects/synth/browser/src/static-server.mjs",
    port: 4173,
    reuseExistingServer: true,
  },
};
