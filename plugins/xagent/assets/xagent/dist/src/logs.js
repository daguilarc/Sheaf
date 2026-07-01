import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
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
    const timestamp = clock().toISOString();
    await mkdir(runDir, { recursive: true });
    await writeFile(normalizedLogPath, "", { flag: "a" });
    await writeFile(rawProviderLogPath, "", { flag: "a" });
    const metadata = {
        run_id: runId,
        harness: options.harness,
        mode: options.mode,
        model: options.model,
        thinking_level: options.thinkingLevel,
        created_at: timestamp,
        updated_at: timestamp,
        exit_status: "running",
        paths: {
            run_dir: path.relative(logRoot, runDir),
            metadata: path.relative(logRoot, metadataPath),
            normalized: path.relative(logRoot, normalizedLogPath),
            raw_provider: path.relative(logRoot, rawProviderLogPath),
        },
        runDir,
        metadataPath,
        normalizedLogPath,
        rawProviderLogPath,
    };
    await writeMetadata(metadata);
    return metadata;
}
export async function appendNormalizedEvent(record, event) {
    await appendJsonLine(record.normalizedLogPath, event);
}
export async function appendRawProviderEvent(record, event) {
    await appendJsonLine(record.rawProviderLogPath, event);
}
export async function updateRunExitStatus(record, exitStatus, clock = () => new Date()) {
    record.exit_status = exitStatus;
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
            runs.push(metadata);
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
                continue;
            }
            throw error;
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
    const { runDir: _runDir, metadataPath: _metadataPath, normalizedLogPath: _normalized, rawProviderLogPath: _raw, ...metadata } = record;
    await writeFile(record.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=logs.js.map