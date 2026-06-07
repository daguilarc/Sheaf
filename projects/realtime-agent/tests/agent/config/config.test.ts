import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ConfigLoadError,
  LoadOpenAiApiKey,
  LoadRealtimeAgentConfig,
} from "../../../src/agent/src/config.js";
import {
  FindRepositoryRoot,
  GetDefaultRealtimeAgentPaths,
  ResolveRepositoryPath,
} from "../../../src/agent/src/repo_paths.js";

function CreateFakeRepoRoot(): string
{
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "realtime-agent-repo-"));
  mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  mkdirSync(path.join(repoRoot, "structure"), { recursive: true });
  writeFileSync(path.join(repoRoot, "config", "services.json"), "{}");
  return repoRoot;
}

test("FindRepositoryRoot locates the repository from a nested path", () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const nested = path.join(repoRoot, "projects", "realtime-agent", "src");

  try
  {
    mkdirSync(nested, { recursive: true });
    assert.equal(FindRepositoryRoot(nested), repoRoot);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("GetDefaultRealtimeAgentPaths resolves repository-relative locations", () =>
{
  const repoRoot = CreateFakeRepoRoot();

  try
  {
    const paths = GetDefaultRealtimeAgentPaths(repoRoot);

    assert.equal(
      paths.defaultPromptFile,
      path.join(
        repoRoot,
        "projects/realtime-agent/prompts/system-prompts/basic_realtime_conversation_v1.md",
      ),
    );
    assert.equal(
      paths.databasePath,
      path.join(repoRoot, "data/realtime-agent/realtime-agent.sqlite"),
    );
    assert.equal(
      paths.runtimeLogPath,
      path.join(repoRoot, "logs/realtime-agent/realtime-agent.jsonl"),
    );
    assert.equal(
      ResolveRepositoryPath("data/realtime-agent/realtime-agent.sqlite", repoRoot),
      paths.databasePath,
    );
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("LoadRealtimeAgentConfig merges config file values with defaults", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const configPath = path.join(repoRoot, "config", "realtime-agent.json");

  try
  {
    await writeFile(
      configPath,
      JSON.stringify({
        model: "custom-model",
        default_prompt_file: "projects/realtime-agent/prompts/custom.md",
      }),
    );

    const config = await LoadRealtimeAgentConfig({ repoRoot, configPath });

    assert.equal(config.model, "custom-model");
    assert.equal(
      config.defaultPromptPath,
      path.join(repoRoot, "projects/realtime-agent/prompts/custom.md"),
    );
    assert.equal(
      config.databasePath,
      path.join(repoRoot, "data/realtime-agent/realtime-agent.sqlite"),
    );
    assert.equal(
      config.runtimeLogPath,
      path.join(repoRoot, "logs/realtime-agent/realtime-agent.jsonl"),
    );
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("LoadOpenAiApiKey reads openai_api_key from config/api_keys.json", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const apiKeysPath = path.join(repoRoot, "config", "api_keys.json");

  try
  {
    await writeFile(apiKeysPath, JSON.stringify({ openai_api_key: "repo-key" }));

    const apiKey = await LoadOpenAiApiKey({ repoRoot, apiKeysPath });
    assert.equal(apiKey, "repo-key");
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("LoadOpenAiApiKey reports actionable error when key is missing", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const apiKeysPath = path.join(repoRoot, "config", "api_keys.json");

  try
  {
    await assert.rejects(
      () => LoadOpenAiApiKey({ repoRoot, apiKeysPath }),
      (error: Error) =>
      {
        assert.ok(error instanceof ConfigLoadError);
        return error.message.includes("config/api_keys.json");
      },
    );
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
