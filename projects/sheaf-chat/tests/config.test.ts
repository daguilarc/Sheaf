import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BuildLocalModelMetadata,
  LoadSheafChatConfig,
  x_defaultAgentIdleOffloadSeconds,
} from "../src/server/config.js";

function CreateFakeRepoRoot(): string
{
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "sheaf-chat-repo-"));
  mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  mkdirSync(path.join(repoRoot, "structure"), { recursive: true });
  writeFileSync(path.join(repoRoot, "config", "services.json"), "[]");
  return repoRoot;
}

test("LoadSheafChatConfig applies defaults when optional files are missing", async () =>
{
  const repoRoot = CreateFakeRepoRoot();

  try
  {
    const config = await LoadSheafChatConfig({ repoRoot });

    assert.equal(config.agentIdleOffloadSeconds, x_defaultAgentIdleOffloadSeconds);
    assert.equal(config.localInferenceUrl, null);
    assert.equal(config.localInferenceApiKey, null);
    assert.equal(config.localInferenceAvailable, false);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("LoadSheafChatConfig reads top-level global config keys", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const globalConfigPath = path.join(repoRoot, "config", "global_config.json");

  try
  {
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        local_inference_url: "http://studio.local:8000/v1/",
        agent_idle_offload_seconds: 120,
      }),
    );

    const config = await LoadSheafChatConfig({ repoRoot, globalConfigPath });

    assert.equal(config.localInferenceUrl, "http://studio.local:8000/v1/");
    assert.equal(config.agentIdleOffloadSeconds, 120);
    assert.equal(config.localInferenceAvailable, false);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("LoadSheafChatConfig ignores nested sheaf_chat global config", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const globalConfigPath = path.join(repoRoot, "config", "global_config.json");

  try
  {
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        sheaf_chat: {
          local_inference_url: "http://nested.local/v1/",
          agent_idle_offload_seconds: 60,
        },
      }),
    );

    const config = await LoadSheafChatConfig({ repoRoot, globalConfigPath });

    assert.equal(config.localInferenceUrl, null);
    assert.equal(config.agentIdleOffloadSeconds, x_defaultAgentIdleOffloadSeconds);
    assert.equal(config.localInferenceAvailable, false);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("LoadSheafChatConfig tolerates missing local inference secret", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const globalConfigPath = path.join(repoRoot, "config", "global_config.json");
  const apiKeysPath = path.join(repoRoot, "config", "api_keys.json");

  try
  {
    await writeFile(
      globalConfigPath,
      JSON.stringify({ local_inference_url: "http://studio.local:8000/v1/" }),
    );
    await writeFile(apiKeysPath, JSON.stringify({ openai_api_key: "test-key" }));

    const config = await LoadSheafChatConfig({ repoRoot, globalConfigPath, apiKeysPath });
    const model = BuildLocalModelMetadata(config, "qwen3-coder");

    assert.equal(config.localInferenceAvailable, false);
    assert.equal(model.available, false);
    assert.equal(model.provider, "local");
    assert.equal(model.id, "qwen3-coder");
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("LoadSheafChatConfig marks local inference available when url and key exist", async () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const globalConfigPath = path.join(repoRoot, "config", "global_config.json");
  const apiKeysPath = path.join(repoRoot, "config", "api_keys.json");

  try
  {
    await writeFile(
      globalConfigPath,
      JSON.stringify({ local_inference_url: "http://studio.local:8000/v1/" }),
    );
    await writeFile(
      apiKeysPath,
      JSON.stringify({ local_inference_api_key: "local-secret" }),
    );

    const config = await LoadSheafChatConfig({ repoRoot, globalConfigPath, apiKeysPath });
    const model = BuildLocalModelMetadata(config);

    assert.equal(config.localInferenceAvailable, true);
    assert.equal(model.available, true);
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
