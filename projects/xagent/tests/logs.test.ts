import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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
  openRunRecord,
  updateRunSupervision,
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

test("listRuns still surfaces pre-supervision legacy metadata", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-legacy-list-"));
  const logRoot = getDefaultLogRoot(repoRoot);
  const runId = "xrun_20260621000000000_legacy01";
  const runDir = path.join(logRoot, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "metadata.json"),
    `${JSON.stringify({
      run_id: runId,
      harness: "codex",
      mode: "subagent",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:01:00.000Z",
      exit_status: "completed",
      paths: {
        run_dir: runId,
        metadata: `${runId}/metadata.json`,
        normalized: `${runId}/normalized.jsonl`,
        raw_provider: `${runId}/raw-provider.jsonl`,
      },
    }, null, 2)}\n`,
  );

  const runs = await listRuns(logRoot);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.run_id, runId);
  assert.equal(runs[0]?.harness, "codex");
  assert.equal(runs[0]?.exit_status, "completed");
  assert.equal(runs[0]?.supervision.phase, "completed");
  assert.equal(runs[0]?.watchdog.invocation_count, 0);
  assert.equal(runs[0]?.paths.watchdog, path.join(runId, "watchdog.jsonl"));
});

test("listRuns surfaces non-ENOENT I/O errors instead of swallowing them", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-list-io-"));
  const logRoot = getDefaultLogRoot(repoRoot);
  const runId = "xrun_20260621000000000_ioerr01";
  const runDir = path.join(logRoot, runId);
  await mkdir(runDir, { recursive: true });
  // A directory where metadata.json should be makes readFile fail with EISDIR.
  await mkdir(path.join(runDir, "metadata.json"));

  await assert.rejects(() => listRuns(logRoot), (error: NodeJS.ErrnoException) => {
    assert.equal(error.code, "EISDIR");
    return true;
  });
});

test("readNormalizedLog rejects path traversal run ids", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-logs-"));
  const logRoot = getDefaultLogRoot(repoRoot);

  await assert.rejects(() => readNormalizedLog(logRoot, "../metadata"), /Invalid run id/);
  await assert.rejects(() => readNormalizedLog(logRoot, "xrun_20260621000000000_00000001/../other"), /Invalid run id/);
});

test("run metadata includes durable supervision, process ownership, and watchdog aggregates", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-metadata-"));
  const record = await createRunRecord({
    repoRoot,
    runId: "xrun_metadata",
    harness: "codex",
    mode: "subagent",
    clock: () => new Date("2026-07-25T12:00:00.000Z"),
  });

  assert.deepEqual(record.supervision, {
    phase: "starting",
    sequence: 0,
    last_transport_progress_at: "2026-07-25T12:00:00.000Z",
    last_semantic_progress_at: "2026-07-25T12:00:00.000Z",
    provider_thread_id: undefined,
  });
  assert.deepEqual(record.watchdog, {
    invocation_count: 0,
    controller_wake_count: 0,
    deterministic_alert_count: 0,
    evidence_truncation_count: 0,
  });
  assert.equal(record.owned_process, undefined);
  assert.equal(record.exit_status, "running");

  await updateRunSupervision(
    record,
    {
      phase: "running",
      sequence: 3,
      last_transport_progress_at: "2026-07-25T12:01:00.000Z",
      last_semantic_progress_at: "2026-07-25T12:00:30.000Z",
      provider_thread_id: "provider-thread",
      owned_process: {
        pid: 1234,
        process_group_id: 1234,
        started_at: "2026-07-25T11:59:59.000Z",
        start_identity: "pid:1234:start:2026-07-25T11:59:59.000Z",
      },
      watchdog: {
        invocation_count: 2,
        controller_wake_count: 1,
        deterministic_alert_count: 1,
        evidence_truncation_count: 0,
        input_tokens: 100,
        output_tokens: 20,
        estimated_cost_usd: 0.001,
        last_verdict: "healthy",
      },
    },
    () => new Date("2026-07-25T12:01:00.000Z"),
  );

  const persisted = JSON.parse(await readFile(record.metadataPath, "utf8"));
  assert.equal(persisted.exit_status, "running");
  assert.deepEqual(persisted.supervision, {
    phase: "running",
    sequence: 3,
    last_transport_progress_at: "2026-07-25T12:01:00.000Z",
    last_semantic_progress_at: "2026-07-25T12:00:30.000Z",
    provider_thread_id: "provider-thread",
  });
  assert.deepEqual(persisted.owned_process, {
    pid: 1234,
    process_group_id: 1234,
    started_at: "2026-07-25T11:59:59.000Z",
    start_identity: "pid:1234:start:2026-07-25T11:59:59.000Z",
  });
  assert.equal(persisted.watchdog.last_verdict, "healthy");
  assert.deepEqual(
    (await readdir(record.runDir)).filter((entry) => entry.includes("metadata.json.")),
    [],
  );
});

test("supervised terminal phases persist a matching exit status", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-exit-status-"));
  const logRoot = path.join(await mkdtemp(path.join(tmpdir(), "xagent-exit-root-")), "xagent");
  const runId = "xrun_20260727000000000_0000ab01";

  const record = await createRunRecord({
    repoRoot,
    logRoot,
    runId,
    harness: "claude_code",
    mode: "subagent",
    supervised: true,
  });
  assert.equal(record.exit_status, "running");

  await updateRunSupervision(record, {
    ...record.supervision,
    phase: "running",
    sequence: 3,
  });
  assert.equal(record.exit_status, "running");

  await updateRunSupervision(record, {
    ...record.supervision,
    phase: "failed",
    sequence: 4,
  });
  assert.equal(record.exit_status, "failed");

  const persisted = await openRunRecord(logRoot, runId);
  assert.equal(persisted.exit_status, "failed");
  assert.equal(persisted.supervision.phase, "failed");
});

test("a completed supervised phase persists exit status completed", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-exit-status-ok-"));
  const logRoot = path.join(await mkdtemp(path.join(tmpdir(), "xagent-exit-ok-root-")), "xagent");
  const runId = "xrun_20260727000000000_0000ab02";

  const record = await createRunRecord({
    repoRoot,
    logRoot,
    runId,
    harness: "cursor",
    mode: "subagent",
    supervised: true,
  });
  await updateRunSupervision(record, {
    ...record.supervision,
    phase: "completed",
    sequence: 7,
  });

  const persisted = await openRunRecord(logRoot, runId);
  assert.equal(persisted.exit_status, "completed");
});
