import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AssertNotGlobalPiPath,
  CreateSheafAuthStorage,
  IsGlobalPiPath,
  ResolveOpenAiAuthDir,
  ResolveSheafAgentDir,
  ResolveSheafAuthJsonPath,
  ResolveSheafModelsJsonPath,
} from "../../../src/agents/auth.js";
import { BuildTestConfig, WithFakeRepo } from "./helpers.js";

test("Sheaf auth paths stay under data/sheaf-chat and avoid global Pi", () =>
{
  WithFakeRepo((repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot);
    const agentDir = ResolveSheafAgentDir(config);
    const authPath = ResolveSheafAuthJsonPath(config);
    const modelsPath = ResolveSheafModelsJsonPath(config);
    const openAiAuthDir = ResolveOpenAiAuthDir(config);

    assert.match(agentDir, /data[\\/]sheaf-chat[\\/]pi-agent$/);
    assert.match(authPath, /data[\\/]sheaf-chat[\\/]pi-agent[\\/]auth\.json$/);
    assert.match(modelsPath, /data[\\/]sheaf-chat[\\/]pi-agent[\\/]models\.json$/);
    assert.match(openAiAuthDir, /data[\\/]sheaf-chat[\\/]auth[\\/]openai$/);
    assert.equal(IsGlobalPiPath(authPath), false);
    assert.equal(IsGlobalPiPath(path.join(os.homedir(), ".pi", "agent", "auth.json")), true);
    assert.throws(
      () => AssertNotGlobalPiPath(path.join(os.homedir(), ".pi", "agent", "auth.json")),
      /refusing to use global Pi path/,
    );
  });
});

test("CreateSheafAuthStorage uses the Sheaf auth.json path", () =>
{
  WithFakeRepo((repoRoot) =>
  {
    const config = BuildTestConfig(repoRoot);
    const authStorage = CreateSheafAuthStorage(config);

    assert.equal(authStorage.has("openai"), false);
    assert.equal(ResolveSheafAuthJsonPath(config).includes(".pi"), false);
  });
});
