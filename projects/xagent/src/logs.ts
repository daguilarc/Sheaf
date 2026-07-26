import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { HarnessName, OutputEvent, OutputMode, ThinkingLevel } from "./events.js";
import type { OwnedProcessIdentity } from "./adapters/types.js";
import type {
  SupervisionEvent,
  SupervisionPhase,
  WatchdogAggregate,
  WatchdogTelemetry,
} from "./supervision/types.js";

const GENERATED_RUN_ID_PATTERN = /^xrun_[0-9]{17}_[0-9a-f]{8}$/;
const TEST_RUN_ID_PATTERN = /^xrun_[A-Za-z0-9_]+$/;

export type RunMetadata = {
  run_id: string;
  harness: HarnessName;
  mode: OutputMode;
  model?: string;
  thinking_level?: ThinkingLevel;
  created_at: string;
  updated_at: string;
  exit_status: "running" | "completed" | "failed";
  supervision: {
    phase: SupervisionPhase;
    sequence: number;
    last_transport_progress_at: string;
    last_semantic_progress_at: string;
    provider_thread_id?: string;
  };
  watchdog: WatchdogAggregate;
  owned_process?: OwnedProcessIdentity;
  paths: {
    run_dir: string;
    metadata: string;
    normalized: string;
    raw_provider: string;
    watchdog: string;
  };
};

export type RunRecord = RunMetadata & {
  runDir: string;
  metadataPath: string;
  normalizedLogPath: string;
  rawProviderLogPath: string;
  watchdogLogPath: string;
};

export type CreateRunRecordOptions = {
  readonly repoRoot: string;
  readonly logRoot?: string;
  readonly harness: HarnessName;
  readonly mode: OutputMode;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly runId?: string;
  readonly clock?: () => Date;
};

export async function createRunRecord(options: CreateRunRecordOptions): Promise<RunRecord> {
  const clock = options.clock ?? (() => new Date());
  const runId = options.runId ?? generateRunId(clock());
  validateRunIdForCreate(runId);
  const logRoot = options.logRoot ?? getDefaultLogRoot(options.repoRoot);
  const runDir = getRunDir(logRoot, runId);
  const metadataPath = path.join(runDir, "metadata.json");
  const normalizedLogPath = path.join(runDir, "normalized.jsonl");
  const rawProviderLogPath = path.join(runDir, "raw-provider.jsonl");
  const watchdogLogPath = path.join(runDir, "watchdog.jsonl");
  const timestamp = clock().toISOString();

  await mkdir(runDir, { recursive: true });
  await writeFile(normalizedLogPath, "", { flag: "a" });
  await writeFile(rawProviderLogPath, "", { flag: "a" });
  await writeFile(watchdogLogPath, "", { flag: "a" });

  const metadata: RunRecord = {
    run_id: runId,
    harness: options.harness,
    mode: options.mode,
    model: options.model,
    thinking_level: options.thinkingLevel,
    created_at: timestamp,
    updated_at: timestamp,
    exit_status: "running",
    supervision: {
      phase: "starting",
      sequence: 0,
      last_transport_progress_at: timestamp,
      last_semantic_progress_at: timestamp,
      provider_thread_id: undefined,
    },
    watchdog: {
      invocation_count: 0,
      controller_wake_count: 0,
      deterministic_alert_count: 0,
      evidence_truncation_count: 0,
    },
    owned_process: undefined,
    paths: {
      run_dir: path.relative(logRoot, runDir),
      metadata: path.relative(logRoot, metadataPath),
      normalized: path.relative(logRoot, normalizedLogPath),
      raw_provider: path.relative(logRoot, rawProviderLogPath),
      watchdog: path.relative(logRoot, watchdogLogPath),
    },
    runDir,
    metadataPath,
    normalizedLogPath,
    rawProviderLogPath,
    watchdogLogPath,
  };

  await writeMetadata(metadata);
  return metadata;
}

export async function appendNormalizedEvent(
  record: RunRecord,
  event: OutputEvent | SupervisionEvent,
): Promise<void> {
  await appendJsonLine(record.normalizedLogPath, event);
}

export async function openRunRecord(
  logRoot: string,
  runId: string,
): Promise<RunRecord> {
  validateRunIdForCreate(runId);
  const runDir = getRunDir(logRoot, runId);
  const metadataPath = path.join(runDir, "metadata.json");
  assertPathInside(logRoot, metadataPath);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as RunMetadata;
  if (metadata.run_id !== runId) {
    throw new Error(`Run metadata id ${metadata.run_id} does not match directory ${runId}.`);
  }
  return {
    ...metadata,
    runDir,
    metadataPath,
    normalizedLogPath: path.join(runDir, "normalized.jsonl"),
    rawProviderLogPath: path.join(runDir, "raw-provider.jsonl"),
    watchdogLogPath: path.join(runDir, "watchdog.jsonl"),
  };
}

export async function appendRawProviderEvent(record: RunRecord, event: unknown): Promise<void> {
  await appendJsonLine(record.rawProviderLogPath, event);
}

export async function appendWatchdogTelemetry(
  record: RunRecord,
  telemetry: WatchdogTelemetry,
): Promise<void> {
  await appendJsonLine(record.watchdogLogPath, telemetry);
}

export async function updateRunExitStatus(
  record: RunRecord,
  exitStatus: RunMetadata["exit_status"],
  clock: () => Date = () => new Date(),
): Promise<void> {
  record.exit_status = exitStatus;
  record.updated_at = clock().toISOString();
  await writeMetadata(record);
}

export type RunSupervisionUpdate = RunMetadata["supervision"] & {
  readonly watchdog?: WatchdogAggregate;
  readonly owned_process?: OwnedProcessIdentity;
};

export async function updateRunSupervision(
  record: RunRecord,
  update: RunSupervisionUpdate,
  clock: () => Date = () => new Date(),
): Promise<void> {
  const { watchdog, owned_process, ...supervision } = update;
  record.supervision = supervision;
  if (watchdog !== undefined) {
    record.watchdog = watchdog;
  }
  record.owned_process = owned_process;
  record.updated_at = clock().toISOString();
  await writeMetadata(record);
}

export async function listRuns(logRoot: string): Promise<RunMetadata[]> {
  const root = logRoot;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const runs: RunMetadata[] = [];
  for (const entry of entries) {
    try {
      const metadata = JSON.parse(await readFile(path.join(root, entry, "metadata.json"), "utf8")) as RunMetadata;
      runs.push(metadata);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return runs.sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function readNormalizedLog(logRoot: string, runId: string): Promise<string> {
  validateGeneratedRunId(runId);
  const logPath = path.join(getRunDir(logRoot, runId), "normalized.jsonl");
  assertPathInside(logRoot, logPath);
  return readFile(logPath, "utf8");
}

export function generateRunId(date: Date = new Date()): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  return `xrun_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function getDefaultLogRoot(repoRoot: string): string {
  return path.join(repoRoot, "data", "xagent");
}

function getRunDir(logRoot: string, runId: string): string {
  return path.join(logRoot, runId);
}

function validateRunIdForCreate(runId: string): void {
  if (!TEST_RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
}

function validateGeneratedRunId(runId: string): void {
  if (!GENERATED_RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
}

function assertPathInside(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes xagent data directory: ${candidate}`);
  }
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(value)}\n`);
}

async function writeMetadata(record: RunRecord): Promise<void> {
  const {
    runDir: _runDir,
    metadataPath: _metadataPath,
    normalizedLogPath: _normalized,
    rawProviderLogPath: _raw,
    watchdogLogPath: _watchdog,
    ...metadata
  } = record;
  const temporaryPath = path.join(
    path.dirname(record.metadataPath),
    `.${path.basename(record.metadataPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await rename(temporaryPath, record.metadataPath);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
