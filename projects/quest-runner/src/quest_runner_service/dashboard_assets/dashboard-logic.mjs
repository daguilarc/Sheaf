/**
 * Pure helpers for dashboard shell (unit-tested with Node).
 */

const x_STORAGE_KEY = "conductor_dashboard.project";

export const x_SERVICE_CONTROL_LABELS = [
  "Register service",
  "Restart service",
  "Stop service",
  "Start service",
  "Service logs",
  "MCP configuration",
  "Services",
];

export function StorageProjectKey() {
  return x_STORAGE_KEY;
}

/**
 * Resolve which project name to use.
 * Precedence: valid query > valid stored > valid default > first listed.
 * If query names a project that is not listed, surface invalidQueryProject and fall back.
 */
export function ResolveProjectSelection(
  queryProject,
  storedProject,
  defaultProject,
  listedProjects
) {
  const valid = new Set(listedProjects);
  const isValid = (p) => p != null && String(p).length > 0 && valid.has(String(p));

  let invalidQueryProject = null;
  if (queryProject != null && String(queryProject).length > 0 && !isValid(queryProject)) {
    invalidQueryProject = String(queryProject);
  }

  if (isValid(queryProject)) {
    return { project: String(queryProject), invalidQueryProject: null };
  }
  if (isValid(storedProject)) {
    return { project: String(storedProject), invalidQueryProject };
  }
  if (isValid(defaultProject)) {
    return { project: String(defaultProject), invalidQueryProject };
  }
  const first = listedProjects.length ? listedProjects[0] : null;
  return { project: first, invalidQueryProject };
}

export function BuildQuestApiQuery(project, questType, questNumber) {
  return {
    project,
    quest_type: questType,
    quest_number: questNumber,
  };
}

export function BuildDashboardSearchParams({
  project,
  questType,
  questNumber,
  page,
  sliceNumber,
  subpage,
}) {
  const p = new URLSearchParams();
  if (project) {
    p.set("project", project);
  }
  if (questType != null && questNumber != null) {
    p.set("quest_type", questType);
    p.set("quest_number", String(questNumber));
    if (page) {
      p.set("page", page);
    }
    if (page === "slice") {
      if (sliceNumber != null) {
        p.set("slice_number", String(sliceNumber));
      }
      if (subpage) {
        p.set("subpage", subpage);
      }
    }
  }
  return p;
}

export function BuildRunQuestPayload(project, questType, questNumber, maxSteps) {
  const body = {
    project,
    quest_type: questType,
    quest_number: questNumber,
  };
  if (maxSteps != null) {
    body.max_steps = maxSteps;
  }
  return body;
}

export function ShouldShowRunButton(overview, runStatus) {
  if (!overview) {
    return false;
  }
  if (overview.quest_state === "Completed") {
    return false;
  }
  if (overview.worktree_missing) {
    return false;
  }
  const overlay =
    overview.execution_overlay_status ??
    runStatus?.execution_overlay_status ??
    "none";
  if (overlay === "human_intervention" || overlay === "paused" || overlay === "running") {
    return false;
  }
  if (runStatus?.active_run != null) {
    return false;
  }
  return true;
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
