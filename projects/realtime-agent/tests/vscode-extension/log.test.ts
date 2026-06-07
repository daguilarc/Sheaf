import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CreateExtensionLog } from "../../src/vscode-extension/src/log.js";

function CreateFakeOutputChannel(): { channel: import("vscode").OutputChannel; lines: string[] }
{
  const lines: string[] = [];
  const channel = {
    appendLine(message: string)
    {
      lines.push(message);
    },
  } as import("vscode").OutputChannel;

  return { channel, lines };
}

test("CreateExtensionLog writes structured JSONL when repo root is present", () =>
{
  const repoRoot = mkdtempSync(join(tmpdir(), "sheaf-log-repo-"));
  const logDir = join(repoRoot, "logs", "realtime-agent");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "vscode-extension.jsonl");

  try
  {
    const { channel, lines } = CreateFakeOutputChannel();
    const log = CreateExtensionLog({
      channel,
      runtimeLogPath: logPath,
    });

    log.LogEvent("extension_session_started", { session_id: "abc" });

    const content = readFileSync(logPath, "utf8").trim();
    const entry = JSON.parse(content) as { event: string; fields?: Record<string, unknown> };
    assert.equal(entry.event, "extension_session_started");
    assert.equal(entry.fields?.session_id, "abc");
    assert.ok(lines.some((line) => line.includes("extension_session_started")));
  }
  finally
  {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("CreateExtensionLog keeps Output Channel logging without repo root", () =>
{
  const { channel, lines } = CreateFakeOutputChannel();
  const log = CreateExtensionLog({ channel });

  log.Line("hello");
  log.Error("boom", new Error("detail"));

  assert.equal(lines[0], "hello");
  assert.ok(lines[1]?.startsWith("boom: Error: detail"));
});
