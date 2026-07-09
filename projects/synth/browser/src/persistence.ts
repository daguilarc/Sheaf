export const BROWSER_DATA_ROOT = "/data";
export const BROWSER_PERSISTENCE_STATUS_PATH = "runtime.file.status";

export type BrowserPersistencePaths = {
  dataRoot: string;
  patchesRoot: string;
  logsRoot: string;
  configFile: string;
};

export type BrowserFileSystem = {
  filesystems: { IDBFS: unknown };
  mkdir(path: string): void;
  mount(type: unknown, options: object, path: string): void;
  syncfs(populate: boolean, complete: (error?: Error) => void): void;
};

export type BrowserPersistenceStatus = "persistence pending" | "persistence succeeded" | "persistence failed";
export type BrowserPersistenceOptions = { debounceMs?: number };
export type BrowserPersistenceFactory = (
  filesystem: BrowserFileSystem,
  reportStatus: (status: BrowserPersistenceStatus) => void,
) => BrowserPersistence;

function isAlreadyPresent(error: unknown): boolean {
  return error instanceof Error && /exist|busy/i.test(error.message);
}

function normalizePatchPath(path: string): string {
  if (path.startsWith("/")) throw new Error("patch path must be relative");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new Error("patch path escapes persistence root");
    segments.push(segment);
  }
  if (segments.length === 0) throw new Error("patch path is required");
  return segments.join("/");
}

export class BrowserPersistence {
  readonly paths: BrowserPersistencePaths = {
    dataRoot: BROWSER_DATA_ROOT,
    patchesRoot: `${BROWSER_DATA_ROOT}/patches`,
    logsRoot: `${BROWSER_DATA_ROOT}/logs`,
    configFile: `${BROWSER_DATA_ROOT}/config.json`,
  };
  private readonly debounceMs: number;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private statusValue: BrowserPersistenceStatus = "persistence pending";

  constructor(
    private readonly filesystem: BrowserFileSystem,
    options: BrowserPersistenceOptions = {},
    private readonly reportStatus: (status: BrowserPersistenceStatus) => void = () => {},
  ) {
    this.debounceMs = options.debounceMs ?? 100;
  }

  async start(): Promise<void> {
    if (this.started) return;
    try {
      this.ensureDirectory(this.paths.dataRoot);
      this.filesystem.mount(this.filesystem.filesystems.IDBFS, {}, this.paths.dataRoot);
      this.ensureDirectory(this.paths.patchesRoot);
      this.ensureDirectory(this.paths.logsRoot);
      this.setStatus("persistence pending");
      await this.sync(true);
      this.started = true;
      this.setStatus("persistence succeeded");
    } catch (error) {
      this.setStatus("persistence failed");
      throw error;
    }
  }

  scheduleSync(): void {
    if (!this.started) return;
    this.setStatus("persistence pending");
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (!this.started) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    try {
      await this.sync(false);
      this.setStatus("persistence succeeded");
    } catch {
      this.setStatus("persistence failed");
    }
  }

  status(): BrowserPersistenceStatus { return this.statusValue; }

  patchPath(path: string): string {
    return `${this.paths.patchesRoot}/${normalizePatchPath(path)}`;
  }

  private ensureDirectory(path: string): void {
    try {
      this.filesystem.mkdir(path);
    } catch (error) {
      if (!isAlreadyPresent(error)) throw error;
    }
  }

  private sync(populate: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.filesystem.syncfs(populate, (error) => error ? reject(error) : resolve());
    });
  }

  private setStatus(status: BrowserPersistenceStatus): void {
    this.statusValue = status;
    this.reportStatus(status);
  }
}
