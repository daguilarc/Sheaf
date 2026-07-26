import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

import type { OwnedProcessIdentity } from "../adapters/types.js";

const execFileAsync = promisify(execFile);

export type ProcessInspection = {
  readonly pid: number;
  readonly process_group_id?: number;
  readonly start_identity: string;
};

export type ProcessInspector = {
  inspect(pid: number): Promise<ProcessInspection | undefined>;
  terminateProcessGroup(processGroupId: number): Promise<void>;
};

export const platformProcessInspector: ProcessInspector = {
  async inspect(pid): Promise<ProcessInspection | undefined> {
    validateProcessId(pid);
    try {
      const { stdout } = await execFileAsync(
        "/bin/ps",
        ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)],
        { encoding: "utf8" },
      );
      return parseProcessInspection(pid, stdout);
    } catch (error) {
      if (isMissingProcess(error)) {
        return undefined;
      }
      throw error;
    }
  },

  async terminateProcessGroup(processGroupId): Promise<void> {
    validateProcessId(processGroupId);
    if (process.platform === "win32") {
      throw new Error("Process-group signalling is not supported on Windows.");
    }
    try {
      process.kill(-processGroupId, "SIGTERM");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ESRCH") {
        throw error;
      }
    }
  },
};

export function captureOwnedProcessIdentity(
  pid: number,
  clock: () => Date = () => new Date(),
): OwnedProcessIdentity | undefined {
  validateProcessId(pid);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let output: string;
    try {
      output = execFileSync(
        "/bin/ps",
        ["-o", "pgid=", "-o", "lstart=", "-p", String(pid)],
        { encoding: "utf8" },
      );
    } catch (error) {
      if (isMissingProcess(error)) {
        continue;
      }
      throw error;
    }
    const inspection = parseProcessInspection(pid, output);
    if (inspection !== undefined) {
      return {
        pid,
        process_group_id: inspection.process_group_id,
        started_at: clock().toISOString(),
        start_identity: inspection.start_identity,
      };
    }
  }
  return undefined;
}

function parseProcessInspection(
  pid: number,
  output: string,
): ProcessInspection | undefined {
  const match = /^\s*(\d+)\s+(.+?)\s*$/s.exec(output);
  if (match === null) {
    return undefined;
  }
  const processGroupId = Number(match[1]);
  const startedAt = match[2]?.replace(/\s+/g, " ").trim();
  if (
    !Number.isSafeInteger(processGroupId)
    || processGroupId <= 0
    || startedAt === undefined
    || startedAt === ""
  ) {
    return undefined;
  }
  return {
    pid,
    process_group_id: processGroupId,
    start_identity: `ps-lstart:${startedAt}`,
  };
}

function validateProcessId(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process id: ${pid}`);
  }
}

function isMissingProcess(error: unknown): boolean {
  return isNodeError(error)
    && (
      error.code === "ESRCH"
      || error.code === 1
      || (
        error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? false
        : typeof error.status === "number" && error.status === 1
      )
    );
}

function isNodeError(
  error: unknown,
): error is Error & {
  readonly code?: string | number;
  readonly status?: number;
} {
  return error instanceof Error;
}
