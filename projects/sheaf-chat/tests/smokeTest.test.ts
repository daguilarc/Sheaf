import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LoadSheafChatConfig } from "../src/server/config.js";
import {
  IsSmokeTestModeActive,
  ResolveSmokeAssetRoot,
  x_smokeAssetRootEnvVar,
  x_smokeTestModeEnvVar,
} from "../src/server/smoke_test.js";

function CreateRepoRoot(prefix: string): string
{
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "structure"), { recursive: true });
  writeFileSync(path.join(root, "config", "services.json"), "[]");
  return root;
}

test("IsSmokeTestModeActive parses truthy and falsy values", () =>
{
  assert.equal(IsSmokeTestModeActive("1"), true);
  assert.equal(IsSmokeTestModeActive("true"), true);
  assert.equal(IsSmokeTestModeActive("TRUE"), true);

  assert.equal(IsSmokeTestModeActive(undefined), false);
  assert.equal(IsSmokeTestModeActive(""), false);
  assert.equal(IsSmokeTestModeActive("0"), false);
  assert.equal(IsSmokeTestModeActive("false"), false);
});

test("ResolveSmokeAssetRoot returns repo root when smoke mode is off", () =>
{
  const resolved = ResolveSmokeAssetRoot({
    repoRoot: "/repo/worktree",
    env: { [x_smokeAssetRootEnvVar]: "/main/checkout" },
    directoryExists: () => true,
  });

  assert.equal(resolved.assetRoot, "/repo/worktree");
  assert.equal(resolved.usedSmokeAssetRoot, false);
  assert.equal(resolved.warning, null);
});

test("ResolveSmokeAssetRoot uses the asset root when valid", () =>
{
  const resolved = ResolveSmokeAssetRoot({
    repoRoot: "/repo/worktree",
    env: { [x_smokeTestModeEnvVar]: "1", [x_smokeAssetRootEnvVar]: "/main/checkout" },
    directoryExists: (candidate) => candidate === "/main/checkout",
  });

  assert.equal(resolved.assetRoot, "/main/checkout");
  assert.equal(resolved.usedSmokeAssetRoot, true);
  assert.equal(resolved.warning, null);
});

test("ResolveSmokeAssetRoot falls back with a warning when asset root is missing", () =>
{
  const resolved = ResolveSmokeAssetRoot({
    repoRoot: "/repo/worktree",
    env: { [x_smokeTestModeEnvVar]: "1", [x_smokeAssetRootEnvVar]: "/nope" },
    directoryExists: () => false,
  });

  assert.equal(resolved.assetRoot, "/repo/worktree");
  assert.equal(resolved.usedSmokeAssetRoot, false);
  assert.ok(resolved.warning);
});

test("LoadSheafChatConfig reads API keys from the smoke asset root", async () =>
{
  const worktree = CreateRepoRoot("sheaf-chat-worktree-");
  const assetRoot = CreateRepoRoot("sheaf-chat-assets-");

  try
  {
    // Worktree has no key; the main asset root has the real key.
    writeFileSync(
      path.join(assetRoot, "config", "api_keys.json"),
      JSON.stringify({ openai_api_key: "asset-root-key" }),
    );

    const config = await LoadSheafChatConfig({
      repoRoot: worktree,
      env: { [x_smokeTestModeEnvVar]: "1", [x_smokeAssetRootEnvVar]: assetRoot },
    });

    assert.equal(config.openAiApiKey, "asset-root-key");
  }
  finally
  {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(assetRoot, { recursive: true, force: true });
  }
});

test("LoadSheafChatConfig reads API keys from the worktree when smoke mode is off", async () =>
{
  const worktree = CreateRepoRoot("sheaf-chat-worktree-");
  const assetRoot = CreateRepoRoot("sheaf-chat-assets-");

  try
  {
    writeFileSync(
      path.join(worktree, "config", "api_keys.json"),
      JSON.stringify({ openai_api_key: "worktree-key" }),
    );
    writeFileSync(
      path.join(assetRoot, "config", "api_keys.json"),
      JSON.stringify({ openai_api_key: "asset-root-key" }),
    );

    const config = await LoadSheafChatConfig({
      repoRoot: worktree,
      env: {},
    });

    assert.equal(config.openAiApiKey, "worktree-key");
  }
  finally
  {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(assetRoot, { recursive: true, force: true });
  }
});
