import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendNormalizedEvent,
  appendRawProviderEvent,
  createRunRecord,
  getDefaultLogRoot,
  listRuns,
  readNormalizedLog,
} from "../src/logs.js";

test("creates run records under the configured log root and appends normalized/raw logs", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-logs-"));
  const logRoot = path.join(await mkdtemp(path.join(tmpdir(), "xagent-central-")), "xagent");
  const runId = "xrun_20260621000000000_00000001";

  const record = await createRunRecord({
    repoRoot,
    logRoot,
    runId,
    harness: "codex",
    mode: "subagent",
    clock: () => new Date("2026-06-21T00:00:00.000Z"),
  });

  assert.equal(record.runDir, path.join(logRoot, runId));
  await stat(path.join(record.runDir, "metadata.json"));
  await stat(path.join(record.runDir, "normalized.jsonl"));
  await stat(path.join(record.runDir, "raw-provider.jsonl"));

  await appendNormalizedEvent(record, {
    schema_version: 1,
    type: "session.ready",
    run_id: runId,
    sequence: 1,
    timestamp: "2026-06-21T00:00:00.000Z",
    can_accept_input: true,
  });
  await appendRawProviderEvent(record, { provider: "line" });

  const normalized = await readFile(path.join(record.runDir, "normalized.jsonl"), "utf8");
  const rawProvider = await readFile(path.join(record.runDir, "raw-provider.jsonl"), "utf8");
  assert.equal(JSON.parse(normalized).type, "session.ready");
  assert.deepEqual(JSON.parse(rawProvider), { provider: "line" });
});

test("listRuns and readNormalizedLog inspect persisted files without live state", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-logs-"));
  const logRoot = getDefaultLogRoot(repoRoot);
  const runId = "xrun_20260621000000000_00000002";

  const record = await createRunRecord({
    repoRoot,
    runId,
    harness: "cursor",
    mode: "full",
    clock: () => new Date("2026-06-21T00:00:00.000Z"),
  });
  await appendNormalizedEvent(record, {
    schema_version: 1,
    type: "status",
    run_id: runId,
    sequence: 1,
    timestamp: "2026-06-21T00:00:00.000Z",
    level: "info",
    message: "persisted",
  });

  const runs = await listRuns(logRoot);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.run_id, runId);
  assert.equal(runs[0]?.harness, "cursor");
  assert.equal(runs[0]?.mode, "full");

  const logText = await readNormalizedLog(logRoot, runId);
  assert.equal(JSON.parse(logText).message, "persisted");
});

test("readNormalizedLog rejects path traversal run ids", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-logs-"));
  const logRoot = getDefaultLogRoot(repoRoot);

  await assert.rejects(() => readNormalizedLog(logRoot, "../metadata"), /Invalid run id/);
  await assert.rejects(() => readNormalizedLog(logRoot, "xrun_20260621000000000_00000001/../other"), /Invalid run id/);
});
