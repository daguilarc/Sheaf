import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CreateRuntimeLogger } from "../../../src/agent/src/runtime_log.js";

function CreateFakeRepoRoot(): string
{
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "realtime-agent-repo-"));
  mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  mkdirSync(path.join(repoRoot, "structure"), { recursive: true });
  writeFileSync(path.join(repoRoot, "config", "services.json"), "{}");
  return repoRoot;
}

test("CreateRuntimeLogger writes JSONL entries under logs/realtime-agent/", () =>
{
  const repoRoot = CreateFakeRepoRoot();
  const logPath = path.join(repoRoot, "logs/realtime-agent/realtime-agent.jsonl");

  try
  {
    const logger = CreateRuntimeLogger({ logPath, repoRoot });
    logger.Log("cli_startup", { model: "gpt-realtime-2", api_key: "secret" });
    logger.Close();

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);

    const entry = JSON.parse(lines[0] ?? "{}") as {
      event: string;
      fields?: Record<string, unknown>;
    };

    assert.equal(entry.event, "cli_startup");
    assert.equal(entry.fields?.api_key, "[redacted]");
    assert.equal(entry.fields?.model, "gpt-realtime-2");
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
