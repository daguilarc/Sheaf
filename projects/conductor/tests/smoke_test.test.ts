import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";

import {
  SMOKE_ASSET_ROOT_ENV_VAR,
  SMOKE_TEST_MODE_ENV_VAR,
  buildSmokeTestEnv,
  discoverSmokeAssetRoot,
  isSmokeTestModeActive,
} from "../src/index.js";

test("isSmokeTestModeActive parses truthy and falsy values", () =>
{
  assert.equal(isSmokeTestModeActive("1"), true);
  assert.equal(isSmokeTestModeActive("true"), true);
  assert.equal(isSmokeTestModeActive("TRUE"), true);
  assert.equal(isSmokeTestModeActive("yes"), true);

  assert.equal(isSmokeTestModeActive(undefined), false);
  assert.equal(isSmokeTestModeActive(""), false);
  assert.equal(isSmokeTestModeActive("   "), false);
  assert.equal(isSmokeTestModeActive("0"), false);
  assert.equal(isSmokeTestModeActive("false"), false);
  assert.equal(isSmokeTestModeActive("False"), false);
});

test("discoverSmokeAssetRoot prefers the explicit override", () =>
{
  const root = discoverSmokeAssetRoot({
    repoRoot: "/repo/worktree",
    env: { [SMOKE_ASSET_ROOT_ENV_VAR]: "/main/checkout" },
    readGitCommonDir: () => "/should/not/be/used/.git",
  });

  assert.equal(root, "/main/checkout");
});

test("discoverSmokeAssetRoot derives the main working tree from the shared .git", () =>
{
  // From a worktree, `git rev-parse --git-common-dir` returns the main repo's
  // .git; its parent is the main working tree.
  const root = discoverSmokeAssetRoot({
    repoRoot: "/repo/worktree",
    env: {},
    readGitCommonDir: () => dirname("/repo/worktree") + "/main/.git",
  });

  assert.equal(root, "/repo/main");
});

test("discoverSmokeAssetRoot falls back to repo root when git discovery yields nothing", () =>
{
  const root = discoverSmokeAssetRoot({
    repoRoot: process.cwd(),
    env: {},
    readGitCommonDir: () => undefined,
  });

  assert.equal(root, process.cwd());
});

test("buildSmokeTestEnv sets the mode flag and asset root", () =>
{
  const env = buildSmokeTestEnv("/main/checkout");

  assert.equal(env[SMOKE_TEST_MODE_ENV_VAR], "1");
  assert.equal(env[SMOKE_ASSET_ROOT_ENV_VAR], "/main/checkout");
  assert.equal(isSmokeTestModeActive(env[SMOKE_TEST_MODE_ENV_VAR]), true);
});
