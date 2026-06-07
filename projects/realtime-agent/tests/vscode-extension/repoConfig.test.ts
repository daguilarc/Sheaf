import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  FindSheafRepositoryRoot,
  FindSheafRepositoryRootFromWorkspaceFolders,
  LoadOpenAiApiKeyFromRepoConfig,
  ResolveExtensionRuntimeLogPath,
} from "../../src/vscode-extension/src/repoConfig.js";

function CreateFakeSheafRepoRoot(): string
{
  const root = mkdtempSync(join(tmpdir(), "sheaf-repo-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "structure"), { recursive: true });
  mkdirSync(join(root, "projects", "realtime-agent"), { recursive: true });
  writeFileSync(join(root, "config", "services.json"), "{}");
  return root;
}

test("FindSheafRepositoryRoot locates repository root from nested workspace folder", () =>
{
  const root = CreateFakeSheafRepoRoot();
  const nested = join(root, "projects", "realtime-agent", "src", "vscode-extension");

  try
  {
    mkdirSync(nested, { recursive: true });
    assert.equal(FindSheafRepositoryRoot(nested), root);
  }
  finally
  {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FindSheafRepositoryRootFromWorkspaceFolders returns first matching repo root", () =>
{
  const root = CreateFakeSheafRepoRoot();

  try
  {
    const found = FindSheafRepositoryRootFromWorkspaceFolders([
      { uri: { fsPath: join(root, "projects", "realtime-agent") } },
    ]);
    assert.equal(found, root);
  }
  finally
  {
    rmSync(root, { recursive: true, force: true });
  }
});

test("LoadOpenAiApiKeyFromRepoConfig reads openai_api_key from config/api_keys.json", async () =>
{
  const root = CreateFakeSheafRepoRoot();

  try
  {
    writeFileSync(
      join(root, "config", "api_keys.json"),
      JSON.stringify({ openai_api_key: "sk-repo-key" }),
    );

    const loaded = await LoadOpenAiApiKeyFromRepoConfig(root);
    assert.equal(loaded.apiKey, "sk-repo-key");
    assert.equal(loaded.error, undefined);
  }
  finally
  {
    rmSync(root, { recursive: true, force: true });
  }
});

test("LoadOpenAiApiKeyFromRepoConfig reports parse failures", async () =>
{
  const root = CreateFakeSheafRepoRoot();

  try
  {
    writeFileSync(join(root, "config", "api_keys.json"), "{not-json");

    const loaded = await LoadOpenAiApiKeyFromRepoConfig(root);
    assert.equal(loaded.apiKey, undefined);
    assert.ok(loaded.error?.includes("api_keys.json"));
  }
  finally
  {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ResolveExtensionRuntimeLogPath uses logs/realtime-agent under repo root", () =>
{
  const root = "/tmp/sheaf";
  assert.equal(
    ResolveExtensionRuntimeLogPath(root),
    join(root, "logs", "realtime-agent", "vscode-extension.jsonl"),
  );
});
