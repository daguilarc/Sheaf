import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { HarnessName, OutputEvent, OutputMode, ThinkingLevel } from "./events.js";

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
  paths: {
    run_dir: string;
    metadata: string;
    normalized: string;
    raw_provider: string;
  };
};

export type RunRecord = RunMetadata & {
  runDir: string;
  metadataPath: string;
  normalizedLogPath: string;
  rawProviderLogPath: string;
};

export type CreateRunRecordOptions = {
  readonly repoRoot: string;
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
  const runDir = getRunDir(options.repoRoot, runId);
  const metadataPath = path.join(runDir, "metadata.json");
  const normalizedLogPath = path.join(runDir, "normalized.jsonl");
  const rawProviderLogPath = path.join(runDir, "raw-provider.jsonl");
  const timestamp = clock().toISOString();

  await mkdir(runDir, { recursive: true });
  await writeFile(normalizedLogPath, "", { flag: "a" });
  await writeFile(rawProviderLogPath, "", { flag: "a" });

  const metadata: RunRecord = {
    run_id: runId,
    harness: options.harness,
    mode: options.mode,
    model: options.model,
    thinking_level: options.thinkingLevel,
    created_at: timestamp,
    updated_at: timestamp,
    exit_status: "running",
    paths: {
      run_dir: path.relative(options.repoRoot, runDir),
      metadata: path.relative(options.repoRoot, metadataPath),
      normalized: path.relative(options.repoRoot, normalizedLogPath),
      raw_provider: path.relative(options.repoRoot, rawProviderLogPath),
    },
    runDir,
    metadataPath,
    normalizedLogPath,
    rawProviderLogPath,
  };

  await writeMetadata(metadata);
  return metadata;
}

export async function appendNormalizedEvent(record: RunRecord, event: OutputEvent): Promise<void> {
  await appendJsonLine(record.normalizedLogPath, event);
}

export async function appendRawProviderEvent(record: RunRecord, event: unknown): Promise<void> {
  await appendJsonLine(record.rawProviderLogPath, event);
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

export async function listRuns(repoRoot: string): Promise<RunMetadata[]> {
  const root = getXagentDataDir(repoRoot);
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

export async function readNormalizedLog(repoRoot: string, runId: string): Promise<string> {
  validateGeneratedRunId(runId);
  const logPath = path.join(getRunDir(repoRoot, runId), "normalized.jsonl");
  assertPathInside(getXagentDataDir(repoRoot), logPath);
  return readFile(logPath, "utf8");
}

export function generateRunId(date: Date = new Date()): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  return `xrun_${timestamp}_${randomBytes(4).toString("hex")}`;
}

function getXagentDataDir(repoRoot: string): string {
  return path.join(repoRoot, "data", "xagent");
}

function getRunDir(repoRoot: string, runId: string): string {
  return path.join(getXagentDataDir(repoRoot), runId);
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
  const { runDir: _runDir, metadataPath: _metadataPath, normalizedLogPath: _normalized, rawProviderLogPath: _raw, ...metadata } = record;
  await writeFile(record.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
