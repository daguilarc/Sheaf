/**
 * Pure helpers for dashboard shell (unit-tested with Node).
 */

const x_STORAGE_KEY = "conductor_dashboard.repo_path";

export function StorageRepoKey() {
  return x_STORAGE_KEY;
}

/**
 * Resolve which tracked repository path to use.
 * Precedence: valid query > valid stored > valid default > first tracked.
 * If query names a path that is not tracked, surface invalidQueryPath and fall back.
 */
export function ResolveRepositorySelection(
  queryRepoPath,
  storedRepoPath,
  defaultRepoPath,
  trackedPaths
) {
  const valid = new Set(trackedPaths);
  const isValid = (p) => p != null && String(p).length > 0 && valid.has(String(p));

  let invalidQueryPath = null;
  if (queryRepoPath != null && String(queryRepoPath).length > 0 && !isValid(queryRepoPath)) {
    invalidQueryPath = String(queryRepoPath);
  }

  if (isValid(queryRepoPath)) {
    return { repoPath: String(queryRepoPath), invalidQueryPath: null };
  }
  if (isValid(storedRepoPath)) {
    return { repoPath: String(storedRepoPath), invalidQueryPath };
  }
  if (isValid(defaultRepoPath)) {
    return { repoPath: String(defaultRepoPath), invalidQueryPath };
  }
  const first = trackedPaths.length ? trackedPaths[0] : null;
  return { repoPath: first, invalidQueryPath };
}

/**
 * Polls only while getVisible() is true; fires immediately when tab becomes visible again.
 */
export class RefreshScheduler {
  constructor(options) {
    this.m_intervalMs = options.intervalMs;
    this.m_onTick = options.onTick;
    this.m_getVisible = options.getVisible;
    this.m_timer = null;
    this.m_onVisibility = () => {
      if (this.m_getVisible()) {
        void this.m_onTick();
      }
    };
  }

  Start() {
    this.Stop();
    this.m_timer = setInterval(() => {
      if (this.m_getVisible()) {
        void this.m_onTick();
      }
    }, this.m_intervalMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.m_onVisibility);
    }
  }

  Stop() {
    if (this.m_timer != null) {
      clearInterval(this.m_timer);
      this.m_timer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.m_onVisibility);
    }
  }
}

export function MergeRunBadge(overview, runStatus) {
  const overlay = overview?.execution_overlay_status ?? "none";
  const activeRun = runStatus?.active_run;
  if (overlay === "human_intervention") {
    return { label: "Human intervention required", variant: "hi" };
  }
  if (overlay === "paused") {
    const until = overview?.paused_until ?? runStatus?.paused_until;
    return {
      label: until ? `Paused until ${until}` : "Paused",
      variant: "paused",
    };
  }
  if (overlay === "running" || activeRun != null) {
    return { label: "Running", variant: "running" };
  }
  return { label: "Idle / Not running", variant: "idle" };
}
