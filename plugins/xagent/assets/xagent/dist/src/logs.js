import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
const GENERATED_RUN_ID_PATTERN = /^xrun_[0-9]{17}_[0-9a-f]{8}$/;
const TEST_RUN_ID_PATTERN = /^xrun_[A-Za-z0-9_]+$/;
export async function createRunRecord(options) {
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
    const metadata = {
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
export async function appendNormalizedEvent(record, event) {
    await appendJsonLine(record.normalizedLogPath, event);
}
export async function openRunRecord(logRoot, runId) {
    validateRunIdForCreate(runId);
    const runDir = getRunDir(logRoot, runId);
    const metadataPath = path.join(runDir, "metadata.json");
    assertPathInside(logRoot, metadataPath);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
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
export async function appendRawProviderEvent(record, event) {
    await appendJsonLine(record.rawProviderLogPath, event);
}
export async function appendWatchdogTelemetry(record, telemetry) {
    await appendJsonLine(record.watchdogLogPath, telemetry);
}
export async function updateRunExitStatus(record, exitStatus, clock = () => new Date()) {
    record.exit_status = exitStatus;
    record.updated_at = clock().toISOString();
    await writeMetadata(record);
}
export async function updateRunSupervision(record, update, clock = () => new Date()) {
    const { watchdog, owned_process, ...supervision } = update;
    record.supervision = supervision;
    if (watchdog !== undefined) {
        record.watchdog = watchdog;
    }
    record.owned_process = owned_process;
    record.updated_at = clock().toISOString();
    await writeMetadata(record);
}
export async function listRuns(logRoot) {
    const root = logRoot;
    let entries;
    try {
        entries = await readdir(root);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const runs = [];
    for (const entry of entries) {
        try {
            const metadata = JSON.parse(await readFile(path.join(root, entry, "metadata.json"), "utf8"));
            if (!isRunMetadata(metadata)) {
                continue;
            }
            runs.push(metadata);
        }
        catch {
            continue;
        }
    }
    return runs.sort((left, right) => right.created_at.localeCompare(left.created_at));
}
export async function readNormalizedLog(logRoot, runId) {
    validateGeneratedRunId(runId);
    const logPath = path.join(getRunDir(logRoot, runId), "normalized.jsonl");
    assertPathInside(logRoot, logPath);
    return readFile(logPath, "utf8");
}
export function generateRunId(date = new Date()) {
    const timestamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
    return `xrun_${timestamp}_${randomBytes(4).toString("hex")}`;
}
export function getDefaultLogRoot(repoRoot) {
    return path.join(repoRoot, "data", "xagent");
}
function getRunDir(logRoot, runId) {
    return path.join(logRoot, runId);
}
function validateRunIdForCreate(runId) {
    if (!TEST_RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid run id: ${runId}`);
    }
}
function validateGeneratedRunId(runId) {
    if (!GENERATED_RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid run id: ${runId}`);
    }
}
function assertPathInside(root, candidate) {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path escapes xagent data directory: ${candidate}`);
    }
}
async function appendJsonLine(filePath, value) {
    await appendFile(filePath, `${JSON.stringify(value)}\n`);
}
async function writeMetadata(record) {
    const { runDir: _runDir, metadataPath: _metadataPath, normalizedLogPath: _normalized, rawProviderLogPath: _raw, watchdogLogPath: _watchdog, ...metadata } = record;
    const temporaryPath = path.join(path.dirname(record.metadataPath), `.${path.basename(record.metadataPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
        await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
        await rename(temporaryPath, record.metadataPath);
    }
    finally {
        try {
            await unlink(temporaryPath);
        }
        catch (error) {
            if (!isNodeError(error) || error.code !== "ENOENT") {
                throw error;
            }
        }
    }
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function isRunMetadata(value) {
    if (!isRecord(value)
        || !isRecord(value.supervision)
        || !isRecord(value.watchdog)
        || !isRecord(value.paths)) {
        return false;
    }
    return (typeof value.run_id === "string"
        && (value.harness === "codex"
            || value.harness === "pi"
            || value.harness === "cursor"
            || value.harness === "claude_code")
        && (value.mode === "subagent" || value.mode === "full")
        && (value.model === undefined || typeof value.model === "string")
        && (value.thinking_level === undefined
            || value.thinking_level === "low"
            || value.thinking_level === "medium"
            || value.thinking_level === "high"
            || value.thinking_level === "xhigh")
        && typeof value.created_at === "string"
        && typeof value.updated_at === "string"
        && (value.exit_status === "running"
            || value.exit_status === "completed"
            || value.exit_status === "failed")
        && (value.supervision.phase === "starting"
            || value.supervision.phase === "running"
            || value.supervision.phase === "ready"
            || value.supervision.phase === "completed"
            || value.supervision.phase === "failed"
            || value.supervision.phase === "cancelled"
            || value.supervision.phase === "abandoned")
        && Number.isSafeInteger(value.supervision.sequence)
        && typeof value.supervision.last_transport_progress_at === "string"
        && typeof value.supervision.last_semantic_progress_at === "string"
        && (value.supervision.provider_thread_id === undefined
            || typeof value.supervision.provider_thread_id === "string")
        && isNonNegativeInteger(value.watchdog.invocation_count)
        && isNonNegativeInteger(value.watchdog.controller_wake_count)
        && isNonNegativeInteger(value.watchdog.deterministic_alert_count)
        && isNonNegativeInteger(value.watchdog.evidence_truncation_count)
        && (value.owned_process === undefined
            || isOwnedProcessIdentity(value.owned_process))
        && typeof value.paths.run_dir === "string"
        && typeof value.paths.metadata === "string"
        && typeof value.paths.normalized === "string"
        && typeof value.paths.raw_provider === "string"
        && typeof value.paths.watchdog === "string");
}
function isOwnedProcessIdentity(value) {
    return isRecord(value)
        && isPositiveInteger(value.pid)
        && (value.process_group_id === undefined
            || isPositiveInteger(value.process_group_id))
        && typeof value.started_at === "string"
        && typeof value.start_identity === "string";
}
function isNonNegativeInteger(value) {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= 0;
}
function isPositiveInteger(value) {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value > 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=logs.js.map