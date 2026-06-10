import {
  BuildAdvanceQuestPayload,
  BuildCreateQuestPayload,
  BuildLandExperimentPayload,
  BuildLandQuestPayload,
  BuildQuestApiQuery,
  BuildDashboardSearchParams,
  BuildRunQuestPayload,
  IsExperimentSelection,
  MergeRunBadge,
  RefreshScheduler,
  ResolveProjectSelection,
  ShouldShowAdvanceButton,
  ShouldShowExperimentLandButton,
  ShouldShowLandButton,
  ShouldShowRunButton,
  StorageProjectKey,
} from "./dashboard-logic.mjs";
import {
  EscapeHtml,
  MarkdownToSafeHtml,
  PlanFileStorageKey,
  SelectPlanFile,
  FileLabelForDiff,
  BuildDiffRowsHtml,
  FormatDashboardTimestamp,
  FormatDashboardTimestampWithAge,
  FormatQuestLastTransitionHtml,
} from "./dashboard-pages-utils.mjs";

const x_POLL_MS = 5000;
const x_COLLAPSE_QUEST = "dash.collapse.questTree";
const x_COLLAPSE_PAGE = "dash.collapse.pageNav";

async function FetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(r.status + " " + (t.slice(0, 120) || r.statusText));
  }
  return r.json();
}

async function ResponseErrorMessage(response) {
  const text = await response.text();
  let msg = text.slice(0, 200) || response.statusText;
  try {
    const j = JSON.parse(text);
    if (j.error) {
      msg = j.error;
    } else if (j.message) {
      msg = j.message;
    }
  } catch (_e) {
    // keep raw text
  }
  return `${response.status} ${msg}`;
}

function Qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== "") p.set(k, String(v));
  }
  return p.toString();
}

function ParseUrl() {
  const u = new URL(window.location.href);
  const p = u.searchParams;
  const experimentId = p.get("experiment_id");
  return {
    project: p.get("project"),
    quest_type: p.get("quest_type"),
    quest_number: p.get("quest_number"),
    experiment_id: experimentId,
    selectedKind: experimentId ? "experiment" : "quest",
    page: p.get("page") || "overview",
    slice_number: p.get("slice_number"),
    subpage: p.get("subpage") || "physicalplan",
  };
}

const state = {
  projectsPayload: null,
  project: null,
  invalidProjectQuery: null,
  snapshot: null,
  questType: null,
  questNumber: null,
  selectedKind: "quest",
  experimentId: null,
  page: "overview",
  sliceNumber: 0,
  subpage: "physicalplan",
  overview: null,
  runStatus: null,
  runActionError: null,
  runActionPending: false,
  createQuestModalOpen: false,
  createQuestType: "main",
  createQuestName: "",
  createQuestError: null,
  createQuestPending: false,
  advanceActionError: null,
  advanceActionPending: false,
  landActionError: null,
  landActionPending: false,
  experimentLandActionError: null,
  experimentLandActionPending: false,
  archivedExperimentDetail: null,
  archivedExperimentDetailId: null,
  lastError: null,
  lastOkAt: null,
  contentCache: {},
  questTreeCollapsed: false,
  pageNavCollapsed: false,
  scheduler: null,
  diffsRequestSeq: 0,
  sliceRequestSeq: 0,
  agentLogRequestSeq: 0,
  agentStepsRequestSeq: 0,
  autoRefreshBlockedUntil: 0,
};

function ReadBoolLs(key, def) {
  const v = localStorage.getItem(key);
  if (v === null) return def;
  return v === "1";
}

function WriteBoolLs(key, val) {
  localStorage.setItem(key, val ? "1" : "0");
}

function PushUrl() {
  const p = BuildDashboardSearchParams({
    project: state.project,
    questType: state.questType,
    questNumber: state.questNumber,
    page: state.page,
    sliceNumber: state.sliceNumber,
    subpage: state.subpage,
    selectedKind: state.selectedKind,
    experimentId: state.experimentId,
  });
  const path = `${window.location.pathname}?${p.toString()}`;
  history.replaceState(null, "", path);
}

function QuestBase() {
  const experimentId = IsExperimentSelection(state.selectedKind)
    ? state.experimentId
    : null;
  return BuildQuestApiQuery(
    state.project,
    state.questType,
    state.questNumber,
    experimentId
  );
}

function IsAgentsChatViewActive() {
  return state.page === "agents";
}

function BuildAgentLogWsUrl(step) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = { ...QuestBase() };
  if (step != null) {
    params.step = String(step);
  }
  return `${proto}//${window.location.host}/api/dashboard/agent_log/stream?${Qs(params)}`;
}

function BuildAgentChatSessionKey(step) {
  const base = QuestBase();
  return [
    base.project,
    base.quest_type,
    base.quest_number,
    step != null ? String(step) : "",
  ].join("|");
}

function DestroyActiveChat() {
  if (state.contentCache.chatHandle && window.ChatView) {
    window.ChatView.destroy(state.contentCache.chatHandle);
  }
  state.contentCache.chatHandle = null;
  state.contentCache.chatSessionKey = null;
}

function DetachActiveChatForReparent() {
  const handle = state.contentCache.chatHandle;
  if (!handle?.root?.parentNode) {
    return null;
  }
  handle.root.parentNode.removeChild(handle.root);
  return handle;
}

function AttachReparentedChat(handle, container) {
  if (!handle || !container) {
    return;
  }
  container.appendChild(handle.root);
  handle.container = container;
}

function MountAgentChatTranscript(main, log) {
  const step = state.contentCache.agentLogStep ?? log.step;
  const sessionKey = BuildAgentChatSessionKey(step);
  const chatContainer = main.querySelector("#dash-agent-chat");
  if (!chatContainer) {
    return;
  }
  if (!window.ChatView) {
    return;
  }
  const wsUrl = BuildAgentLogWsUrl(step);
  state.contentCache.chatHandle = window.ChatView.create(chatContainer, wsUrl);
  state.contentCache.chatSessionKey = sessionKey;
}

function ActiveInteractiveElement() {
  if (typeof document === "undefined") {
    return null;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return null;
  }
  return active.matches("select, input, textarea, [contenteditable='true']") ? active : null;
}

function PauseAutoRefresh(ms = 8000) {
  state.autoRefreshBlockedUntil = Math.max(state.autoRefreshBlockedUntil, Date.now() + ms);
}

function AutoRefreshBlocked() {
  return Date.now() < state.autoRefreshBlockedUntil;
}

function SyncDiffSelectionFromDom() {
  if (typeof document === "undefined") {
    return;
  }
  const el = document.getElementById("dash-diff-commit");
  if (el instanceof HTMLSelectElement && el.value) {
    state.contentCache.selectedCommit = el.value;
  }
}

async function LoadProjects() {
  const j = await FetchJson("/api/dashboard/projects");
  state.projectsPayload = j;
  const listed = (j.projects || []).map((r) => r.project);
  const stored = localStorage.getItem(StorageProjectKey());
  const parsed = ParseUrl();
  const sel = ResolveProjectSelection(
    parsed.project,
    stored,
    j.default_project,
    listed
  );
  state.project = sel.project;
  state.invalidProjectQuery = sel.invalidQueryProject;
  if (state.project) {
    localStorage.setItem(StorageProjectKey(), state.project);
  }
  if (parsed.quest_type && parsed.quest_number != null) {
    const qn = parseInt(parsed.quest_number, 10);
    if (!Number.isNaN(qn) && (parsed.quest_type === "main" || parsed.quest_type === "side")) {
      state.questType = parsed.quest_type;
      state.questNumber = qn;
      state.selectedKind = parsed.selectedKind || "quest";
      state.experimentId =
        parsed.selectedKind === "experiment" ? parsed.experiment_id : null;
      const pages = new Set(["overview", "human", "diffs", "agents", "physicalplan", "slice"]);
      state.page = pages.has(parsed.page) ? parsed.page : "overview";
      if (state.page === "slice") {
        const sn = parseInt(parsed.slice_number || "0", 10);
        state.sliceNumber = Number.isNaN(sn) ? 0 : sn;
        const subs = new Set(["physicalplan", "issues"]);
        state.subpage = subs.has(parsed.subpage) ? parsed.subpage : "physicalplan";
      }
    }
  }
}

async function LoadSnapshot() {
  if (!state.project) {
    state.snapshot = null;
    return;
  }
  try {
    const q = Qs({ project: state.project });
    state.snapshot = await FetchJson(`/api/dashboard/project_snapshot?${q}`);
    if (state.lastError && state.lastError.includes("project")) {
      state.lastError = null;
    }
    state.lastOkAt = new Date().toISOString();
  } catch (e) {
    state.lastError = String(e.message || e);
    state.snapshot = null;
  }
}

function RowForQuest(qt, n) {
  const rows = state.snapshot?.[qt] || [];
  return rows.find((r) => r.number === n);
}

function RowForExperiment(experimentId) {
  const rows = state.snapshot?.experiments || [];
  return rows.find((r) => r.experiment_id === experimentId);
}

function EnsureQuestSelected() {
  if (state.snapshot == null) return;
  if (
    IsExperimentSelection(state.selectedKind) &&
    state.experimentId &&
    state.questType != null
  ) {
    const exp = RowForExperiment(state.experimentId);
    if (
      exp &&
      exp.quest_type === state.questType &&
      exp.quest_number === state.questNumber
    ) {
      return;
    }
    state.selectedKind = "quest";
    state.experimentId = null;
  }
  if (state.questType != null && !IsExperimentSelection(state.selectedKind)) {
    const row = RowForQuest(state.questType, state.questNumber);
    if (row) return;
  }
  const main = state.snapshot.main || [];
  if (main.length) {
    state.questType = "main";
    state.questNumber = main[0].number;
    state.selectedKind = "quest";
    state.experimentId = null;
    state.page = "overview";
    return;
  }
  const side = state.snapshot.side || [];
  if (side.length) {
    state.questType = "side";
    state.questNumber = side[0].number;
    state.selectedKind = "quest";
    state.experimentId = null;
    state.page = "overview";
  } else {
    state.questType = null;
    state.questNumber = null;
    state.selectedKind = "quest";
    state.experimentId = null;
  }
}

async function RefreshHuman() {
  const j = await FetchJson(`/api/dashboard/human_intervention?${Qs(QuestBase())}`);
  state.contentCache.human = j;
  state.lastError = null;
  state.lastOkAt = new Date().toISOString();
}

async function RefreshDiffs() {
  SyncDiffSelectionFromDom();
  const reqSeq = ++state.diffsRequestSeq;
  const j = await FetchJson(`/api/dashboard/git_commits?${Qs({ ...QuestBase(), limit: 50, skip: 0 })}`);
  let sha = state.contentCache.selectedCommit;
  const commitShas = new Set((j.commits || []).map((c) => c.sha));
  if (sha && !commitShas.has(sha)) {
    sha = null;
  }
  if (!sha && j.commits?.length) {
    sha = j.commits[0].sha;
  }
  if (!sha) {
    if (reqSeq !== state.diffsRequestSeq) {
      return;
    }
    state.contentCache.commits = j;
    state.contentCache.selectedCommit = null;
    state.contentCache.diffSummary = null;
    state.contentCache.diffFileDetail = null;
    state.contentCache.diffSelectedPath = null;
    state.lastError = null;
    state.lastOkAt = new Date().toISOString();
    return;
  }
  const summary = await FetchJson(`/api/dashboard/git_diff?${Qs({ ...QuestBase(), commit: sha })}`);
  const paths = (summary.files || []).map((f) => f.path);
  let path = state.contentCache.diffSelectedPath;
  if (!path || !paths.includes(path)) {
    path = paths[0] || null;
  }
  let detail = null;
  if (!path) {
    detail = null;
  } else {
    const meta = summary.files.find((f) => f.path === path);
    if (meta && meta.is_binary) {
      detail = {
        path,
        path_before: meta.path_before,
        change_type: meta.change_type,
        is_binary: true,
        rows: [],
        truncated: false,
      };
    } else {
      detail = await FetchJson(
        `/api/dashboard/git_diff?${Qs({ ...QuestBase(), commit: sha, path })}`
      );
    }
  }
  if (reqSeq !== state.diffsRequestSeq) {
    return;
  }
  state.contentCache.commits = j;
  state.contentCache.selectedCommit = sha;
  state.contentCache.diffSummary = summary;
  state.contentCache.diffSelectedPath = path;
  state.contentCache.diffFileDetail = detail;
  state.lastError = null;
  state.lastOkAt = new Date().toISOString();
}

async function RefreshPhysicalPlanIssues() {
  const j = await FetchJson(`/api/dashboard/physicalplan_issues?${Qs(QuestBase())}`);
  state.contentCache.physicalplan = j;
  state.lastError = null;
  state.lastOkAt = new Date().toISOString();
}

async function RefreshAgentLog() {
  const reqSeq = ++state.agentLogRequestSeq;
  const step = state.contentCache.agentLogStep;
  if (step == null) {
    DestroyActiveChat();
    state.contentCache.agentLog = null;
    state.contentCache.agentLogError = null;
    return;
  }
  const params = { ...QuestBase(), step: String(step) };
  try {
    const log = await FetchJson(`/api/dashboard/agent_log?${Qs(params)}`);
    if (reqSeq !== state.agentLogRequestSeq) {
      return;
    }
    state.contentCache.agentLog = log;
    state.contentCache.agentLogError = null;
  } catch (e) {
    if (reqSeq !== state.agentLogRequestSeq) {
      return;
    }
    state.contentCache.agentLog = null;
    state.contentCache.agentLogError = String(e.message || e);
  }
}

async function RefreshSlicePage() {
  const reqSeq = ++state.sliceRequestSeq;
  const j = await FetchJson(
    `/api/dashboard/slice_page?${Qs({
      ...QuestBase(),
      slice_number: state.sliceNumber,
      subpage: state.subpage,
    })}`
  );
  if (reqSeq !== state.sliceRequestSeq) {
    return;
  }
  state.contentCache.slice = j;
  if (state.subpage === "physicalplan") {
    const files = (j.payload?.files || []).map((f) => f.name);
    const lsKey = PlanFileStorageKey(
      state.project,
      state.questType,
      state.questNumber,
      state.sliceNumber
    );
    const stored = localStorage.getItem(lsKey);
    const sel = SelectPlanFile(files, stored);
    state.contentCache.planSelectedFile = sel;
    if (sel) {
      localStorage.setItem(lsKey, sel);
    }
  }
  state.lastError = null;
  state.lastOkAt = new Date().toISOString();
}

async function RefreshAgentSteps() {
  const reqSeq = ++state.agentStepsRequestSeq;
  const j = await FetchJson(`/api/dashboard/agent_steps?${Qs(QuestBase())}`);
  if (reqSeq !== state.agentStepsRequestSeq) {
    return;
  }
  state.contentCache.agentSteps = j;
  const steps = j.steps || [];
  const stepValues = new Set(steps.map((s) => s.step));
  if (
    state.contentCache.agentLogStep == null ||
    !stepValues.has(state.contentCache.agentLogStep)
  ) {
    state.contentCache.agentLogStep = j.default_step ?? steps[0]?.step ?? null;
  }
  await RefreshAgentLog();
  state.lastError = null;
  state.lastOkAt = new Date().toISOString();
}

async function LoadDiffFileDetailOnly() {
  const sha = state.contentCache.selectedCommit;
  const path = state.contentCache.diffSelectedPath;
  if (!sha || !path) {
    state.contentCache.diffFileDetail = null;
    return;
  }
  const summary = state.contentCache.diffSummary;
  if (!summary?.files) {
    return;
  }
  const meta = summary.files.find((f) => f.path === path);
  if (!meta) {
    return;
  }
  if (meta.is_binary) {
    state.contentCache.diffFileDetail = {
      path,
      path_before: meta.path_before,
      change_type: meta.change_type,
      is_binary: true,
      rows: [],
      truncated: false,
    };
  } else {
    state.contentCache.diffFileDetail = await FetchJson(
      `/api/dashboard/git_diff?${Qs({ ...QuestBase(), commit: sha, path })}`
    );
  }
}

async function PostCreateQuest() {
  const name = String(state.createQuestName || "").trim();
  const body = BuildCreateQuestPayload(state.project, state.createQuestType, name);
  const r = await fetch("/create_quest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(await ResponseErrorMessage(r));
  }
  return r.json();
}

function OpenCreateQuestModal() {
  state.createQuestModalOpen = true;
  state.createQuestType = "main";
  state.createQuestName = "";
  state.createQuestError = null;
  render();
  window.setTimeout(() => {
    const input = document.getElementById("dash-create-quest-name");
    if (input instanceof HTMLInputElement) {
      input.focus();
    }
  }, 0);
}

function CloseCreateQuestModal() {
  if (state.createQuestPending) {
    return;
  }
  state.createQuestModalOpen = false;
  state.createQuestError = null;
  render();
}

async function HandleCreateQuestSubmit() {
  if (state.createQuestPending) {
    return;
  }
  const name = String(state.createQuestName || "").trim();
  if (!name) {
    state.createQuestError = "Quest name is required.";
    render();
    return;
  }
  state.createQuestPending = true;
  state.createQuestError = null;
  render();
  try {
    const created = await PostCreateQuest();
    state.createQuestModalOpen = false;
    state.createQuestName = "";
    state.createQuestError = null;
    state.createQuestPending = false;
    state.selectedKind = "quest";
    state.experimentId = null;
    state.archivedExperimentDetail = null;
    state.archivedExperimentDetailId = null;
    state.questType = created.quest_type;
    state.questNumber = created.quest_number;
    state.page = "overview";
    state.contentCache = {};
    DestroyActiveChat();
    await LoadSnapshot();
    PushUrl();
    await RefreshActivePage({ includeRunStatus: true });
    StartScheduler();
  } catch (e) {
    state.createQuestError = String(e.message || e);
    state.createQuestPending = false;
    render();
  }
}

async function PostRunQuest() {
  const body = BuildRunQuestPayload(state.project, state.questType, state.questNumber);
  const r = await fetch("/run_quest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t.slice(0, 200) || r.statusText;
    try {
      const j = JSON.parse(t);
      if (j.error) {
        msg = j.error;
      } else if (j.message) {
        msg = j.message;
      }
    } catch (_e) {
      // keep raw text
    }
    throw new Error(`${r.status} ${msg}`);
  }
  return r.json();
}

async function HandleRunQuestClick() {
  if (state.runActionPending) {
    return;
  }
  state.runActionPending = true;
  state.runActionError = null;
  render();
  try {
    await PostRunQuest();
    await RefreshActivePage();
  } catch (e) {
    state.runActionError = String(e.message || e);
    render();
  } finally {
    state.runActionPending = false;
  }
}

async function PostAdvanceQuest() {
  const body = BuildAdvanceQuestPayload(state.project, state.questType, state.questNumber);
  const r = await fetch("/advance_quest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t.slice(0, 200) || r.statusText;
    try {
      const j = JSON.parse(t);
      if (j.error) {
        msg = j.error;
      } else if (j.message) {
        msg = j.message;
      }
    } catch (_e) {
      // keep raw text
    }
    throw new Error(`${r.status} ${msg}`);
  }
  return r.json();
}

async function PostLandExperiment() {
  const body = BuildLandExperimentPayload(
    state.project,
    state.questType,
    state.questNumber,
    state.experimentId
  );
  const r = await fetch("/experiments/land", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t.slice(0, 200) || r.statusText;
    try {
      const j = JSON.parse(t);
      if (j.error) {
        msg = j.error;
      } else if (j.message) {
        msg = j.message;
      }
    } catch (_e) {
      // keep raw text
    }
    throw new Error(`${r.status} ${msg}`);
  }
  return r.json();
}

async function PostLandQuest() {
  const body = BuildLandQuestPayload(state.project, state.questType, state.questNumber);
  const r = await fetch("/land", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t.slice(0, 200) || r.statusText;
    try {
      const j = JSON.parse(t);
      if (j.error) {
        msg = j.error;
      } else if (j.message) {
        msg = j.message;
      }
    } catch (_e) {
      // keep raw text
    }
    throw new Error(`${r.status} ${msg}`);
  }
  return r.json();
}

async function RefreshAfterQuestAction() {
  await LoadSnapshot();
  await RefreshActivePage({ includeRunStatus: true });
}

async function HandleAdvanceQuestClick() {
  if (state.advanceActionPending) {
    return;
  }
  state.advanceActionPending = true;
  state.advanceActionError = null;
  render();
  try {
    await PostAdvanceQuest();
    await RefreshAfterQuestAction();
  } catch (e) {
    state.advanceActionError = String(e.message || e);
    render();
  } finally {
    state.advanceActionPending = false;
  }
}

async function HandleLandQuestClick() {
  if (state.landActionPending) {
    return;
  }
  state.landActionPending = true;
  state.landActionError = null;
  render();
  try {
    await PostLandQuest();
    await RefreshAfterQuestAction();
  } catch (e) {
    state.landActionError = String(e.message || e);
    render();
  } finally {
    state.landActionPending = false;
    render();
  }
}

async function HandleLandExperimentClick() {
  if (state.experimentLandActionPending) {
    return;
  }
  state.experimentLandActionPending = true;
  state.experimentLandActionError = null;
  render();
  try {
    await PostLandExperiment();
    state.selectedKind = "quest";
    state.experimentId = null;
    await RefreshAfterQuestAction();
  } catch (e) {
    state.experimentLandActionError = String(e.message || e);
    render();
  } finally {
    state.experimentLandActionPending = false;
    render();
  }
}

async function LoadArchivedExperimentDetail(experimentId) {
  const params = {
    project: state.project,
    quest_type: state.questType,
    quest_number: state.questNumber,
    experiment_id: experimentId,
  };
  state.archivedExperimentDetailId = experimentId;
  state.archivedExperimentDetail = await FetchJson(
    `/api/dashboard/experiments?${Qs(params)}`
  );
}

async function RefreshActivePage(options = {}) {
  if (!state.project || state.questType == null) {
    render();
    return;
  }
  try {
    const b = QuestBase();
    const ov = await FetchJson(`/api/dashboard/quest_overview?${Qs(b)}`);
    state.overview = ov;
    if (state.page === "overview" || options.includeRunStatus) {
      state.runStatus = await FetchJson(`/api/dashboard/run_status?${Qs(b)}`);
    }
    switch (state.page) {
      case "overview":
        break;
      case "human":
        await RefreshHuman();
        break;
      case "diffs":
        await RefreshDiffs();
        break;
      case "agents":
        await RefreshAgentSteps();
        break;
      case "physicalplan":
        await RefreshPhysicalPlanIssues();
        break;
      case "slice":
        await RefreshSlicePage();
        break;
      default:
        break;
    }
    state.lastError = null;
    state.lastOkAt = new Date().toISOString();
  } catch (e) {
    state.lastError = String(e.message || e);
  }
  render();
}

function StartScheduler() {
  if (state.scheduler) state.scheduler.Stop();
  state.scheduler = new RefreshScheduler({
    intervalMs: x_POLL_MS,
    getVisible: () => document.visibilityState === "visible",
    onTick: () => {
      if (ActiveInteractiveElement() || AutoRefreshBlocked()) {
        return Promise.resolve();
      }
      return RefreshActivePage();
    },
  });
  state.scheduler.Start();
}

function NavClass(page, extra) {
  const active = state.page === page;
  let c = "dash-nav-link";
  if (active) c += " dash-nav-link--active";
  if (extra) c += " " + extra;
  return c;
}

function FormatArchivedExperimentsHtml(ov) {
  const archived = ov.archived_experiments || [];
  if (!archived.length) {
    return "";
  }
  const rows = archived
    .map((exp) => {
      const num = String(exp.experiment_number).padStart(4, "0");
      const landed = exp.landed_at ? ` · landed ${FormatDashboardTimestamp(exp.landed_at)}` : "";
      const logs =
        exp.log_count != null
          ? ` · ${EscapeHtml(String(exp.log_count))} log file(s)`
          : "";
      return `<li class="dash-archived-exp">
        <button type="button" class="dash-archived-exp__btn" data-experiment-id="${EscapeHtml(
          exp.experiment_id
        )}">
          <span class="dash-archived-exp__key">exp/${num}</span>
          <span class="dash-archived-exp__desc">${EscapeHtml(
            exp.description || exp.experiment_id
          )}</span>
          <span class="dash-archived-exp__meta">${EscapeHtml(exp.status)}${landed}${logs}</span>
        </button>
      </li>`;
    })
    .join("");
  const detail = state.archivedExperimentDetail;
  let detailHtml = "";
  if (detail && state.archivedExperimentDetailId) {
    const logItems = (detail.logs || [])
      .map(
        (l) =>
          `<li><code>${EscapeHtml(l.path)}</code> (${EscapeHtml(String(l.line_count))} lines)</li>`
      )
      .join("");
    const issueItems = (detail.issues || [])
      .map((i) => {
        const counts =
          i.open_count != null
            ? ` — ${EscapeHtml(String(i.open_count))} open, ${EscapeHtml(
                String(i.completed_count)
              )} completed`
            : "";
        return `<li><code>${EscapeHtml(i.path)}</code>${counts}</li>`;
      })
      .join("");
    const responseItems = (detail.issue_responses || [])
      .map(
        (r) =>
          `<li><code>${EscapeHtml(r.path)}</code>${
            r.response_count != null
              ? ` (${EscapeHtml(String(r.response_count))} responses)`
              : ""
          }</li>`
      )
      .join("");
    const remote = detail.remote_branch
      ? `<dt>Remote branch</dt><dd><code>${EscapeHtml(detail.remote_branch)}</code></dd>`
      : "";
    detailHtml = `
      <div class="dash-archived-detail">
        <h3>Archive detail: ${EscapeHtml(detail.experiment_id)}</h3>
        <dl class="dash-kv">
          <dt>Status</dt><dd>${EscapeHtml(detail.status)}</dd>
          <dt>Created</dt><dd>${FormatDashboardTimestamp(detail.created_at)}</dd>
          <dt>Landed</dt><dd>${FormatDashboardTimestamp(detail.landed_at)}</dd>
          ${remote}
        </dl>
        ${
          logItems
            ? `<h4>Logs</h4><ul class="dash-list">${logItems}</ul>`
            : "<p class=\"dash-muted\">No archived logs.</p>"
        }
        ${
          issueItems
            ? `<h4>Issues</h4><ul class="dash-list">${issueItems}</ul>`
            : ""
        }
        ${
          responseItems
            ? `<h4>Issue responses</h4><ul class="dash-list">${responseItems}</ul>`
            : ""
        }
      </div>`;
  }
  return `
    <h2>Landed experiments</h2>
    <ul class="dash-archived-list">${rows}</ul>
    ${detailHtml}`;
}

function RenderOverview(main) {
  const ov = state.overview;
  const rs = state.runStatus;
  if (!ov) {
    main.innerHTML = `<p class="dash-empty">Loading overview…</p>`;
    return;
  }
  const isExperiment = IsExperimentSelection(state.selectedKind) && ov.experiment;
  const badge = MergeRunBadge(ov, rs);
  const bcls = "dash-badge dash-badge--" + badge.variant;
  const ltHtml = FormatQuestLastTransitionHtml(ov.last_transition);
  const showRun = !isExperiment && ShouldShowRunButton(ov, rs);
  const showAdvance = !isExperiment && ShouldShowAdvanceButton(ov, rs);
  const showLand = !isExperiment && ShouldShowLandButton(ov, rs);
  const showExperimentLand =
    isExperiment && ShouldShowExperimentLandButton(ov);
  const runDisabled = state.runActionPending || !showRun;
  const runLabel = state.runActionPending ? "Starting run…" : "Run quest";
  const advanceDisabled = state.advanceActionPending || !showAdvance;
  const advanceLabel = state.advanceActionPending ? "Advancing…" : "Advance";
  const landDisabled = state.landActionPending || !showLand;
  const landLabel = state.landActionPending ? "Landing…" : "Land quest";
  const experimentLandDisabled =
    state.experimentLandActionPending || !showExperimentLand;
  const experimentLandLabel = state.experimentLandActionPending
    ? "Landing…"
    : "Land experiment";
  const showActionRow =
    showRun ||
    state.runActionPending ||
    showAdvance ||
    state.advanceActionPending ||
    showLand ||
    state.landActionPending ||
    showExperimentLand ||
    state.experimentLandActionPending;
  const runBlock = showActionRow
    ? `<div class="dash-run-row">
        ${
          showRun || state.runActionPending
            ? `<button type="button" id="dash-run-quest" class="dash-btn dash-btn--primary" ${
                runDisabled ? "disabled" : ""
              }>${EscapeHtml(runLabel)}</button>`
            : ""
        }
        ${
          showAdvance || state.advanceActionPending
            ? `<button type="button" id="dash-advance-quest" class="dash-btn" ${
                advanceDisabled ? "disabled" : ""
              }>${EscapeHtml(advanceLabel)}</button>`
            : ""
        }
        ${
          showLand || state.landActionPending
            ? `<button type="button" id="dash-land-quest" class="dash-btn dash-btn--primary" ${
                landDisabled ? "disabled" : ""
              }>${EscapeHtml(landLabel)}</button>`
            : ""
        }
        ${
          showExperimentLand || state.experimentLandActionPending
            ? `<button type="button" id="dash-land-experiment" class="dash-btn dash-btn--primary" ${
                experimentLandDisabled ? "disabled" : ""
              }>${EscapeHtml(experimentLandLabel)}</button>`
            : ""
        }
      </div>
      ${
        showAdvance || state.advanceActionPending
          ? `<p class="dash-advance-hint">Advance applies manual recovery after fix-ups while the quest is stopped. It does not start an agent turn.</p>`
          : ""
      }`
    : "";
  const runErr = state.runActionError
    ? `<p class="dash-run-error">${EscapeHtml(state.runActionError)}</p>`
    : "";
  const advanceErr = state.advanceActionError
    ? `<p class="dash-run-error">${EscapeHtml(state.advanceActionError)}</p>`
    : "";
  const landErr = state.landActionError
    ? `<p class="dash-run-error">${EscapeHtml(state.landActionError)}</p>`
    : "";
  const experimentLandErr = state.experimentLandActionError
    ? `<p class="dash-run-error">${EscapeHtml(state.experimentLandActionError)}</p>`
    : "";
  const checkoutNote = ov.worktree_missing
    ? badge.variant === "landed"
      ? `<p class="dash-banner dash-banner--success">Quest landed; the worktree has been removed.</p>`
      : `<p class="dash-banner">Quest worktree is missing; run is unavailable until the worktree exists.</p>`
    : "";
  const experimentBanner = isExperiment
    ? `<p class="dash-banner dash-banner--experiment">Experiment <code>${EscapeHtml(
        ov.experiment.experiment_id
      )}</code> on parent quest ${EscapeHtml(
        ov.experiment.parent_quest.quest_type +
          "/" +
          String(ov.experiment.parent_quest.quest_number).padStart(4, "0")
      )}</p>`
    : "";
  const experimentSection = isExperiment
    ? `<h2>Experiment</h2>
    <dl class="dash-kv">
      <dt>Experiment id</dt><dd><code>${EscapeHtml(ov.experiment.experiment_id)}</code></dd>
      <dt>Number</dt><dd>${EscapeHtml(String(ov.experiment.experiment_number).padStart(4, "0"))}</dd>
      <dt>Description</dt><dd>${EscapeHtml(ov.experiment.description || "—")}</dd>
      <dt>Status</dt><dd>${EscapeHtml(ov.experiment.status)}</dd>
      <dt>Start step</dt><dd>${EscapeHtml(String(ov.experiment.start_step.global_step))}${
        ov.experiment.start_step.role
          ? ` (${EscapeHtml(ov.experiment.start_step.role)})`
          : ""
      }</dd>
      <dt>Stop condition</dt><dd>${EscapeHtml(ov.experiment.stop_condition.node_name)} (${EscapeHtml(
        ov.experiment.stop_condition.machine_path
      )})</dd>
      <dt>Branch</dt><dd><code>${EscapeHtml(ov.experiment.branch_name)}</code></dd>
      <dt>Worktree</dt><dd>${EscapeHtml(ov.experiment.worktree_path || ov.checkout_path || "")}</dd>
    </dl>`
    : "";
  const archivedHtml =
    !isExperiment && ov.archived_experiments
      ? FormatArchivedExperimentsHtml(ov)
      : "";
  main.innerHTML = `
    <h1>Overview</h1>
    ${experimentBanner}
    <p><span class="${bcls}">${EscapeHtml(badge.label)}</span></p>
    ${runBlock}
    ${runErr}
    ${advanceErr}
    ${landErr}
    ${experimentLandErr}
    ${checkoutNote}
    ${experimentSection}
    <h2>Quest</h2>
    <dl class="dash-kv">
      <dt>Project</dt><dd>${EscapeHtml(ov.project || ov.quest.project || "")}</dd>
      <dt>Key</dt><dd>${EscapeHtml(ov.quest.type + "/" + String(ov.quest.number).padStart(4, "0"))}</dd>
      <dt>Name</dt><dd>${EscapeHtml(ov.quest.name)}</dd>
      <dt>Slug</dt><dd>${EscapeHtml(ov.quest.slug)}</dd>
      <dt>Checkout</dt><dd>${EscapeHtml(ov.checkout_kind || "—")} · ${EscapeHtml(ov.checkout_path || "")}</dd>
      <dt>Path</dt><dd>${EscapeHtml(ov.quest.path)}</dd>
    </dl>
    <h2>State</h2>
    <dl class="dash-kv">
      <dt>Workflow state</dt><dd>${EscapeHtml(ov.workflow_state)}</dd>
      <dt>Active child</dt><dd>${ov.active_child_number == null ? "—" : EscapeHtml(String(ov.active_child_number))}</dd>
      <dt>Slice state</dt><dd>${
        ov.active_child_state
          ? `${EscapeHtml(ov.active_child_state.state)} @ ${FormatDashboardTimestampWithAge(
              ov.active_child_state.updated_at
            )}`
          : "—"
      }</dd>
      <dt>Last update</dt><dd>${FormatDashboardTimestampWithAge(ov.updated_at)}</dd>
      <dt>Last transition</dt><dd>${ltHtml}</dd>
      <dt>Open issues (quest)</dt><dd>${EscapeHtml(String(ov.open_issues_quest_level))}</dd>
      <dt>Open issues (active child)</dt><dd>${EscapeHtml(String(ov.open_issues_active_child))}</dd>
      <dt>Human intervention file</dt><dd>${ov.has_human_intervention_request ? "Yes" : "No"}</dd>
      <dt>Paused</dt><dd>${ov.has_paused_until ? "Yes" : "No"}</dd>
    </dl>
    ${
      rs?.latest_heartbeat_at
        ? `<h2>Run heartbeat</h2><dl class="dash-kv"><dt>Latest heartbeat</dt><dd>${FormatDashboardTimestampWithAge(
            rs.latest_heartbeat_at
          )}</dd></dl>`
        : ""
    }
    ${archivedHtml}
  `;
  const runBtn = main.querySelector("#dash-run-quest");
  if (runBtn) {
    runBtn.addEventListener("click", () => void HandleRunQuestClick());
  }
  const advanceBtn = main.querySelector("#dash-advance-quest");
  if (advanceBtn) {
    advanceBtn.addEventListener("click", () => void HandleAdvanceQuestClick());
  }
  const landBtn = main.querySelector("#dash-land-quest");
  if (landBtn) {
    landBtn.addEventListener("click", () => void HandleLandQuestClick());
  }
  const experimentLandBtn = main.querySelector("#dash-land-experiment");
  if (experimentLandBtn) {
    experimentLandBtn.addEventListener("click", () => void HandleLandExperimentClick());
  }
  for (const btn of main.querySelectorAll(".dash-archived-exp__btn")) {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-experiment-id");
      if (!id) {
        return;
      }
      try {
        await LoadArchivedExperimentDetail(id);
        render();
      } catch (e) {
        state.lastError = String(e.message || e);
        render();
      }
    });
  }
}

function RenderHuman(main) {
  const j = state.contentCache.human;
  if (!j) {
    main.innerHTML = `<p class="dash-empty">Loading…</p>`;
    return;
  }
  if (!j.present) {
    main.innerHTML = `<header class="dash-page-head"><h1>Human intervention</h1></header><p class="dash-empty">No human intervention request is on file for this quest.</p>`;
    return;
  }
  if (!state.contentCache.humanViewMode) {
    state.contentCache.humanViewMode = "rendered";
  }
  const mode = state.contentCache.humanViewMode;
  const body =
    mode === "raw"
      ? `<pre class="dash-pre dash-pre--raw" tabindex="0">${EscapeHtml(j.markdown || "")}</pre>`
      : `<div class="dash-md-reader" tabindex="0">${MarkdownToSafeHtml(j.markdown || "")}</div>`;
  main.innerHTML = `
    <header class="dash-page-head dash-page-head--hi">
      <h1>Human intervention <span class="dash-chip dash-chip--hi">Active request</span></h1>
      <p class="dash-page-meta">Last updated ${FormatDashboardTimestampWithAge(j.updated_at)} · ${EscapeHtml(j.path || "")}</p>
    </header>
    <div class="dash-toggle-row" role="group" aria-label="View mode">
      <button type="button" class="dash-btn dash-btn--tab ${mode === "rendered" ? "dash-btn--tab-active" : ""}" data-human-mode="rendered">Rendered</button>
      <button type="button" class="dash-btn dash-btn--tab ${mode === "raw" ? "dash-btn--tab-active" : ""}" data-human-mode="raw">Raw source</button>
    </div>
    ${body}
  `;
  main.querySelectorAll("[data-human-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.contentCache.humanViewMode = btn.getAttribute("data-human-mode");
      render();
    });
  });
}

function RenderDiffs(main) {
  const j = state.contentCache.commits;
  if (!j) {
    main.innerHTML = `<p class="dash-empty">Loading commits…</p>`;
    return;
  }
  const commits = j.commits || [];
  if (commits.length === 0) {
    main.innerHTML = `<header class="dash-page-head"><h1>Diffs</h1></header><p class="dash-empty">No commits in this repository yet.</p>`;
    return;
  }
  const sel = state.contentCache.selectedCommit || commits[0].sha;
  const opts = commits
    .map(
      (c) =>
        `<option value="${EscapeHtml(c.sha)}" ${c.sha === sel ? "selected" : ""}>${EscapeHtml(
          c.sha.slice(0, 7) + " — " + (c.title || c.message || "").slice(0, 80)
        )}</option>`
    )
    .join("");
  const diff = state.contentCache.diffSummary;
  const selPath = state.contentCache.diffSelectedPath;
  const detail = state.contentCache.diffFileDetail;
  let fileNav = "";
  if (diff && diff.files && diff.files.length) {
    fileNav = `<nav class="dash-diff-filenav" aria-label="Changed files"><ul>${diff.files
      .map((f) => {
        const label = EscapeHtml(FileLabelForDiff(f));
        const active = f.path === selPath ? " dash-diff-file--active" : "";
        const bin = f.is_binary ? ' <span class="dash-chip dash-chip--muted">binary</span>' : "";
        const ren =
          f.change_type && String(f.change_type).startsWith("R")
            ? ' <span class="dash-chip dash-chip--muted">rename</span>'
            : "";
        return `<li><button type="button" class="dash-diff-file${active}" data-diff-file="${EscapeHtml(
          f.path
        )}">${label}${bin}${ren}</button></li>`;
      })
      .join("")}</ul></nav>`;
  } else {
    fileNav = `<p class="dash-empty">No file list for this commit.</p>`;
  }
  let panels = `<p class="dash-empty">Select a file to load a lazy diff.</p>`;
  if (detail) {
    if (detail.is_binary) {
      panels = `<div class="dash-diff-binary"><p><strong>Binary file</strong> — ${EscapeHtml(
        detail.path
      )}</p>${
        detail.path_before
          ? `<p>Previously: ${EscapeHtml(detail.path_before)}</p>`
          : ""
      }</div>`;
    } else {
      const trunc = detail.truncated
        ? `<p class="dash-banner">Diff truncated server-side for size; download from git locally for full content.</p>`
        : "";
      panels = `${trunc}<div class="dash-diff-grid" role="region" aria-label="Diff panels">
        <div class="dash-diff-colhead dash-diff-head-old">Previous</div>
        <div class="dash-diff-colhead dash-diff-head-new">Current</div>
        ${BuildDiffRowsHtml(detail.rows || [])}
      </div>`;
    }
  }
  const meta = diff?.commit;
  const metaLine = meta
    ? `${EscapeHtml(meta.sha?.slice(0, 7) || "")} · ${EscapeHtml(meta.author || "")} · ${FormatDashboardTimestamp(
        meta.committed_at
      )} · ${EscapeHtml(meta.title || "")}`
    : "";
  main.innerHTML = `
    <header class="dash-page-head"><h1>Diffs</h1><p class="dash-page-meta">${metaLine}</p></header>
    <label class="dash-field">Commit
      <select id="dash-diff-commit" aria-label="Select commit">${opts}</select>
    </label>
    <div class="dash-diff-layout">
      <aside class="dash-diff-aside">${fileNav}</aside>
      <section class="dash-diff-main">${panels}</section>
    </div>
  `;
  const commitEl = main.querySelector("#dash-diff-commit");
  if (commitEl) {
    const onCommitPick = async () => {
      PauseAutoRefresh();
      state.contentCache.selectedCommit = commitEl.value;
      state.contentCache.diffSelectedPath = null;
      state.contentCache.diffFileDetail = null;
      try {
        await RefreshDiffs();
      } catch (e) {
        state.lastError = String(e.message || e);
      }
      render();
    };
    commitEl.addEventListener("input", onCommitPick);
    commitEl.addEventListener("change", onCommitPick);
  }
  main.querySelectorAll("[data-diff-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = btn.getAttribute("data-diff-file");
      state.contentCache.diffSelectedPath = path;
      try {
        await LoadDiffFileDetailOnly();
        state.lastError = null;
      } catch (e) {
        state.lastError = String(e.message || e);
      }
      render();
    });
  });
}

function RenderPhysicalPlan(main) {
  const j = state.contentCache.physicalplan;
  if (!j) {
    main.innerHTML = `<p class="dash-empty">Loading…</p>`;
    return;
  }
  const issues = j.issues || [];
  const cards = issues
    .map((i) => {
      const st = i.status === "open" ? "open" : "completed";
      return `<article class="dash-issue-card dash-issue-card--${st}">
        <header class="dash-issue-card__head">
          <span class="dash-issue-id">${EscapeHtml(i.issue_id)}</span>
          <span class="dash-issue-status">${EscapeHtml(i.status)}</span>
        </header>
        <div class="dash-issue-meta">Owner: ${EscapeHtml(i.owner_role || "—")} · Updated ${FormatDashboardTimestampWithAge(
        i.updated_at
      )}</div>
        <h2 class="dash-issue-title">${EscapeHtml(i.title || "")}</h2>
        <div class="dash-issue-details">${MarkdownToSafeHtml(i.details || "")}</div>
        ${
          i.resolution_notes
            ? `<div class="dash-issue-resolution"><strong>Resolution</strong><div class="dash-md-muted">${MarkdownToSafeHtml(
                i.resolution_notes
              )}</div></div>`
            : ""
        }
      </article>`;
    })
    .join("");
  const resp = j.responses_summary || [];
  const respBlock =
    resp.length > 0
      ? `<section class="dash-resp-summary"><h2>Issue responses</h2><ul>${resp
          .map(
            (r) =>
              `<li><strong>${EscapeHtml(r.issue_id)}</strong> ${FormatDashboardTimestamp(
                r.response_timestamp
              )} — ${EscapeHtml(r.outcome || "")}<div class="dash-md-muted">${EscapeHtml(
                r.explanation_preview || ""
              )}</div></li>`
          )
          .join("")}</ul></section>`
      : "";
  main.innerHTML = `
    <header class="dash-page-head"><h1>Physical plan issues</h1>
      <p class="dash-page-meta">Open <strong>${j.open_count}</strong> · Completed <strong>${j.completed_count}</strong>${
    j.latest_update_at ? ` · Latest update ${FormatDashboardTimestampWithAge(j.latest_update_at)}` : ""
  }</p>
    </header>
    ${
      issues.length === 0
        ? '<p class="dash-empty">No issues recorded in physicalplan_issues.md.</p>'
        : `<div class="dash-issue-list">${cards}</div>`
    }
    ${respBlock}
  `;
}

function RenderSlice(main) {
  const j = state.contentCache.slice;
  if (!j) {
    main.innerHTML = `<p class="dash-empty">Loading slice…</p>`;
    return;
  }
  const sub = j.subpage;
  const pay = j.payload;
  const head = `<header class="dash-page-head"><h1>Slice ${EscapeHtml(
    String(j.slice.slice_number).padStart(4, "0")
  )}</h1><p class="dash-page-meta">${EscapeHtml(j.slice.directory_name || "")}${
    j.slice_state
      ? ` · State ${EscapeHtml(j.slice_state.state)} @ ${FormatDashboardTimestampWithAge(
          j.slice_state.updated_at
        )}`
      : ""
  }</p></header>`;

  if (sub === "physicalplan") {
    const files = pay.files || [];
    if (files.length === 0) {
      main.innerHTML = `${head}<p class="dash-empty">No markdown files under physicalplan/ for this slice.</p>`;
      return;
    }
    if (!state.contentCache.planViewMode) {
      state.contentCache.planViewMode = "rendered";
    }
    const mode = state.contentCache.planViewMode;
    const selName = state.contentCache.planSelectedFile || files[0].name;
    const file = files.find((f) => f.name === selName) || files[0];
    const opts = files
      .map(
        (f) =>
          `<option value="${EscapeHtml(f.name)}" ${f.name === file.name ? "selected" : ""}>${EscapeHtml(
            f.name
          )}</option>`
      )
      .join("");
    const body =
      mode === "raw"
        ? `<pre class="dash-pre dash-pre--raw" tabindex="0">${EscapeHtml(file.raw_markdown || "")}</pre>`
        : `<div class="dash-md-reader" tabindex="0">${file.rendered_html || ""}</div>`;
    main.innerHTML = `
      ${head}
      <label class="dash-field">Plan file
        <select id="dash-plan-file" aria-label="Physical plan file">${opts}</select>
      </label>
      <div class="dash-toggle-row" role="group" aria-label="Plan view mode">
        <button type="button" class="dash-btn dash-btn--tab ${mode === "rendered" ? "dash-btn--tab-active" : ""}" data-plan-mode="rendered">Rendered</button>
        <button type="button" class="dash-btn dash-btn--tab ${mode === "raw" ? "dash-btn--tab-active" : ""}" data-plan-mode="raw">Raw source</button>
      </div>
      ${body}
    `;
    const pf = main.querySelector("#dash-plan-file");
    if (pf) {
      pf.addEventListener("change", () => {
        state.contentCache.planSelectedFile = pf.value;
        const lsKey = PlanFileStorageKey(
          state.project,
          state.questType,
          state.questNumber,
          state.sliceNumber
        );
        localStorage.setItem(lsKey, pf.value);
        render();
      });
    }
    main.querySelectorAll("[data-plan-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.contentCache.planViewMode = btn.getAttribute("data-plan-mode");
        render();
      });
    });
    return;
  }

  if (sub === "issues") {
    const issues = pay.issues || [];
    const cards = issues
      .map((i) => {
        const st = i.status === "open" ? "open" : "completed";
        return `<article class="dash-issue-card dash-issue-card--${st}">
          <header class="dash-issue-card__head">
            <span class="dash-issue-id">${EscapeHtml(i.issue_id)}</span>
            <span class="dash-issue-status">${EscapeHtml(i.status)}</span>
          </header>
          <div class="dash-issue-meta">Owner: ${EscapeHtml(i.owner_role || "—")}</div>
          <h2 class="dash-issue-title">${EscapeHtml(i.title || "")}</h2>
          <div class="dash-issue-details">${MarkdownToSafeHtml(i.details || "")}</div>
          ${
            i.resolution_notes
              ? `<div class="dash-issue-resolution"><strong>Resolution</strong><div class="dash-md-muted">${MarkdownToSafeHtml(
                  i.resolution_notes
                )}</div></div>`
              : ""
          }
        </article>`;
      })
      .join("");
    const pri = pay.polishing_issue_responses;
    const respBlock =
      pri && pri.summaries && pri.summaries.length
        ? `<section class="dash-resp-summary"><h2>Polishing responses</h2><ul>${pri.summaries
            .map(
              (r) =>
                `<li><strong>${EscapeHtml(r.issue_id)}</strong> ${FormatDashboardTimestamp(
                  r.response_timestamp
                )} — ${EscapeHtml(r.outcome || "")}<div class="dash-md-muted">${EscapeHtml(
                  r.explanation_preview || ""
                )}</div></li>`
            )
            .join("")}</ul></section>`
        : "";
    main.innerHTML = `
      ${head}
      <p class="dash-page-meta">Open <strong>${pay.open_count}</strong> · Completed <strong>${pay.completed_count}</strong>${
      pay.latest_issue_updated_at
        ? ` · Latest issue ${FormatDashboardTimestampWithAge(pay.latest_issue_updated_at)}`
        : ""
    }</p>
      ${
        issues.length === 0
          ? '<p class="dash-empty">No polishing issues for this slice.</p>'
          : `<div class="dash-issue-list">${cards}</div>`
      }
      ${respBlock}
    `;
    return;
  }

  main.innerHTML = `${head}<p class="dash-empty">No content for this subpage.</p>`;
}

function RenderAgentsPanel({ main, head, steps, emptyText }) {
  if (steps.length === 0) {
    DestroyActiveChat();
    main.innerHTML = `${head}<p class="dash-empty">${EscapeHtml(emptyText)}</p>`;
    return;
  }
  const log = state.contentCache.agentLog;
  const logErr = state.contentCache.agentLogError;
  const step = state.contentCache.agentLogStep ?? log?.step;
  const sessionKey = log ? BuildAgentChatSessionKey(step) : null;
  let reparentHandle = null;
  if (sessionKey && sessionKey === state.contentCache.chatSessionKey && state.contentCache.chatHandle) {
    reparentHandle = DetachActiveChatForReparent();
  } else {
    DestroyActiveChat();
  }
  let logPanel = "";
  if (logErr) {
    logPanel = `<p class="dash-empty">Could not load log: ${EscapeHtml(logErr)}</p>`;
  } else if (!log) {
    logPanel = `<p class="dash-empty">Select a step to view its log.</p>`;
  } else {
    const logSteps = log.log_steps || steps;
    const stepOpts = logSteps
      .map(
        (s) =>
          `<option value="${EscapeHtml(String(s.step))}" ${s.is_current ? "selected" : ""}>Step ${EscapeHtml(
            String(s.step).padStart(4, "0")
          )} — ${EscapeHtml(s.role || log.role || "")} — ${EscapeHtml(s.filename)}</option>`
      )
      .join("");
    const chatBody = window.ChatView
      ? `<div id="dash-agent-chat" class="dash-agent-chat"></div>`
      : `<p class="dash-empty">Chat transcript unavailable: agui-chat.js failed to load.</p>`;
    logPanel = `
      <div class="dash-agent-log-head">
        <h2>Log — step ${EscapeHtml(String(log.step).padStart(4, "0"))} · ${EscapeHtml(log.role || "")}</h2>
        <p class="dash-page-meta">${EscapeHtml(log.metadata?.relative_path || "")} · updated ${FormatDashboardTimestampWithAge(
      log.metadata?.updated_at
    )}</p>
        <label class="dash-field">Step artifact
          <select id="dash-agent-step" aria-label="Log step">${stepOpts}</select>
        </label>
      </div>
      ${chatBody}`;
  }
  main.innerHTML = `
    ${head}
    <section class="dash-agent-main">${logPanel}</section>
  `;
  if (reparentHandle) {
    const chatContainer = main.querySelector("#dash-agent-chat");
    AttachReparentedChat(reparentHandle, chatContainer);
    state.contentCache.chatHandle = reparentHandle;
  } else if (log && window.ChatView) {
    MountAgentChatTranscript(main, log);
  }
  const stepEl = main.querySelector("#dash-agent-step");
  if (stepEl) {
    stepEl.addEventListener("change", async () => {
      DestroyActiveChat();
      state.contentCache.agentLogStep = parseInt(stepEl.value, 10);
      await RefreshAgentLog();
      render();
    });
  }
}

function RenderCreateQuestModal(root) {
  if (!state.createQuestModalOpen) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "dash-modal-backdrop";
  overlay.setAttribute("role", "presentation");
  const dialog = document.createElement("form");
  dialog.className = "dash-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "dash-create-quest-title");
  dialog.innerHTML = `
    <header class="dash-modal__head">
      <h2 id="dash-create-quest-title">Create Quest</h2>
    </header>
    <div class="dash-modal__body">
      <label class="dash-field">Quest type
        <select id="dash-create-quest-type" ${state.createQuestPending ? "disabled" : ""}>
          <option value="main" ${state.createQuestType === "main" ? "selected" : ""}>Main</option>
          <option value="side" ${state.createQuestType === "side" ? "selected" : ""}>Side</option>
        </select>
      </label>
      <label class="dash-field">Quest name
        <input id="dash-create-quest-name" type="text" required value="${EscapeHtml(
          state.createQuestName
        )}" ${state.createQuestPending ? "disabled" : ""} />
      </label>
      ${
        state.createQuestError
          ? `<p class="dash-run-error">${EscapeHtml(state.createQuestError)}</p>`
          : ""
      }
    </div>
    <footer class="dash-modal__actions">
      <button type="button" id="dash-create-quest-cancel" class="dash-btn" ${
        state.createQuestPending ? "disabled" : ""
      }>Cancel</button>
      <button type="submit" class="dash-btn dash-btn--primary" ${
        state.createQuestPending ? "disabled" : ""
      }>${state.createQuestPending ? "Creating..." : "Create"}</button>
    </footer>
  `;
  overlay.appendChild(dialog);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) {
      CloseCreateQuestModal();
    }
  });
  dialog.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void HandleCreateQuestSubmit();
  });
  const typeEl = dialog.querySelector("#dash-create-quest-type");
  if (typeEl instanceof HTMLSelectElement) {
    typeEl.addEventListener("change", () => {
      state.createQuestType = typeEl.value;
    });
  }
  const nameEl = dialog.querySelector("#dash-create-quest-name");
  if (nameEl instanceof HTMLInputElement) {
    nameEl.addEventListener("input", () => {
      state.createQuestName = nameEl.value;
      state.createQuestError = null;
    });
  }
  const cancelEl = dialog.querySelector("#dash-create-quest-cancel");
  if (cancelEl instanceof HTMLButtonElement) {
    cancelEl.addEventListener("click", () => CloseCreateQuestModal());
  }
  root.appendChild(overlay);
}

function render() {
  const root = document.getElementById("app");
  if (!root) return;
  if (!IsAgentsChatViewActive()) {
    DestroyActiveChat();
  }
  root.textContent = "";
  if (state.invalidProjectQuery) {
    const b = document.createElement("div");
    b.className = "dash-banner";
    b.textContent = `The project from the URL is not listed: ${state.invalidProjectQuery}. Showing another selection.`;
    root.appendChild(b);
  }
  if (state.lastError) {
    const e = document.createElement("div");
    e.className = "dash-banner dash-banner--error";
    e.textContent = "Last refresh failed (showing stale data): " + state.lastError;
    root.appendChild(e);
  }
  const top = document.createElement("div");
  top.className = "dash-topbar";
  const lab = document.createElement("label");
  lab.textContent = "Project";
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Project");
  const projects = state.projectsPayload?.projects || [];
  for (const r of projects) {
    const o = document.createElement("option");
    o.value = r.project;
    o.textContent = r.project;
    if (r.project === state.project) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", async () => {
    state.project = sel.value;
    localStorage.setItem(StorageProjectKey(), state.project);
    state.snapshot = null;
    state.overview = null;
    DestroyActiveChat();
    state.contentCache = {};
    await LoadSnapshot();
    EnsureQuestSelected();
    PushUrl();
    await RefreshActivePage();
    StartScheduler();
  });
  lab.appendChild(sel);
  top.appendChild(lab);
  const refBtn = document.createElement("button");
  refBtn.type = "button";
  refBtn.className = "dash-btn";
  refBtn.textContent = "Refresh now";
  refBtn.addEventListener("click", () => void RefreshActivePage());
  top.appendChild(refBtn);
  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "dash-btn dash-btn--primary";
  createBtn.textContent = "Create Quest";
  createBtn.disabled = !state.project;
  createBtn.addEventListener("click", () => OpenCreateQuestModal());
  top.appendChild(createBtn);
  const st = document.createElement("div");
  st.className = "dash-status";
  if (state.lastOkAt) {
    st.innerHTML = `Last OK: ${FormatDashboardTimestampWithAge(state.lastOkAt)}`;
  }
  top.appendChild(st);
  root.appendChild(top);
  if (!state.project || projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-main";
    empty.innerHTML =
      '<p class="dash-empty">No projects with quests found under projects/*/quests/.</p>';
    root.appendChild(empty);
    return;
  }
  const layout = document.createElement("div");
  layout.className = "dash-layout";
  const qPanel = document.createElement("div");
  qPanel.className = "dash-panel" + (state.questTreeCollapsed ? " dash-panel--collapsed" : "");
  const qh = document.createElement("div");
  qh.className = "dash-panel__head";
  qh.textContent = "Quests";
  const qtog = document.createElement("button");
  qtog.type = "button";
  qtog.className = "dash-toggle";
  qtog.textContent = state.questTreeCollapsed ? "Expand" : "Collapse";
  qtog.addEventListener("click", () => {
    state.questTreeCollapsed = !state.questTreeCollapsed;
    WriteBoolLs(x_COLLAPSE_QUEST, state.questTreeCollapsed);
    render();
  });
  qh.appendChild(qtog);
  qPanel.appendChild(qh);
  const qb = document.createElement("div");
  qb.className = "dash-panel__body";
  function addQuestGroup(title, qt) {
    const gt = document.createElement("div");
    gt.className = "dash-group-title";
    gt.textContent = title;
    qb.appendChild(gt);
    const rows = state.snapshot?.[qt] || [];
    for (const r of rows) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dash-quest-row";
      if (
        !IsExperimentSelection(state.selectedKind) &&
        state.questType === qt &&
        state.questNumber === r.number
      ) {
        btn.className += " dash-quest-row--active";
      }
      if (r.has_human_intervention_request) {
        btn.className += " dash-quest-row--hi";
      }
      const k = document.createElement("div");
      k.className = "dash-quest-key";
      k.textContent = `${qt}/${String(r.number).padStart(4, "0")}`;
      const n = document.createElement("div");
      n.className = "dash-quest-name";
      n.textContent = r.name || r.slug || "";
      btn.appendChild(k);
      btn.appendChild(n);
      btn.addEventListener("click", async () => {
        state.selectedKind = "quest";
        state.experimentId = null;
        state.archivedExperimentDetail = null;
        state.archivedExperimentDetailId = null;
        state.questType = qt;
        state.questNumber = r.number;
        state.page = "overview";
        PushUrl();
        await RefreshActivePage();
        StartScheduler();
      });
      qb.appendChild(btn);
    }
  }
  function addExperimentGroup() {
    const experiments = state.snapshot?.experiments || [];
    if (!experiments.length) {
      return;
    }
    const gt = document.createElement("div");
    gt.className = "dash-group-title";
    gt.textContent = "Open experiments";
    qb.appendChild(gt);
    for (const r of experiments) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dash-quest-row dash-quest-row--experiment";
      if (
        IsExperimentSelection(state.selectedKind) &&
        state.experimentId === r.experiment_id
      ) {
        btn.className += " dash-quest-row--active";
      }
      const k = document.createElement("div");
      k.className = "dash-quest-key";
      k.textContent = `exp/${String(r.experiment_number).padStart(4, "0")}`;
      const n = document.createElement("div");
      n.className = "dash-quest-name";
      const parent = `${r.quest_type}/${String(r.quest_number).padStart(4, "0")}`;
      n.textContent = `${parent} · ${r.description || r.experiment_id}`;
      const meta = document.createElement("div");
      meta.className = "dash-quest-meta";
      meta.textContent = `${r.state} · ${r.status}`;
      btn.appendChild(k);
      btn.appendChild(n);
      btn.appendChild(meta);
      btn.addEventListener("click", async () => {
        state.selectedKind = "experiment";
        state.experimentId = r.experiment_id;
        state.questType = r.quest_type;
        state.questNumber = r.quest_number;
        state.archivedExperimentDetail = null;
        state.archivedExperimentDetailId = null;
        state.page = "overview";
        PushUrl();
        await RefreshActivePage();
        StartScheduler();
      });
      qb.appendChild(btn);
    }
  }
  if (state.snapshot) {
    addQuestGroup("Main quests", "main");
    addQuestGroup("Side quests", "side");
    addExperimentGroup();
  } else {
    const p = document.createElement("p");
    p.className = "dash-empty";
    p.textContent = state.lastError ? "Could not load snapshot." : "Loading…";
    qb.appendChild(p);
  }
  qPanel.appendChild(qb);
  layout.appendChild(qPanel);
  const pPanel = document.createElement("div");
  pPanel.className = "dash-panel" + (state.pageNavCollapsed ? " dash-panel--collapsed" : "");
  const ph = document.createElement("div");
  ph.className = "dash-panel__head";
  ph.textContent = "Pages";
  const ptog = document.createElement("button");
  ptog.type = "button";
  ptog.className = "dash-toggle";
  ptog.textContent = state.pageNavCollapsed ? "Expand" : "Collapse";
  ptog.addEventListener("click", () => {
    state.pageNavCollapsed = !state.pageNavCollapsed;
    WriteBoolLs(x_COLLAPSE_PAGE, state.pageNavCollapsed);
    render();
  });
  ph.appendChild(ptog);
  pPanel.appendChild(ph);
  const pb = document.createElement("div");
  pb.className = "dash-panel__body";
  if (state.questType != null) {
    const row = RowForQuest(state.questType, state.questNumber);
    const hi = row?.has_human_intervention_request;
    function addNavLink(label, page, hiExtra) {
      const a = document.createElement("a");
      a.href = "#";
      a.className = NavClass(page, hi && page === "human" ? "dash-nav-link--hi" : hiExtra || "");
      a.textContent = label;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        state.page = page;
        PushUrl();
        void RefreshActivePage();
      });
      pb.appendChild(a);
    }
    addNavLink("Overview", "overview");
    addNavLink("Human intervention", "human", hi ? "dash-nav-link--hi" : "");
    addNavLink("Diffs", "diffs");
    addNavLink("Agents", "agents");
    const ppiOpen = state.overview?.open_issues_quest_level;
    addNavLink(
      ppiOpen
        ? `Physical plan issues (${ppiOpen} open)`
        : "Physical plan issues",
      "physicalplan"
    );
    const slices = state.overview?.slices || [];
    for (const s of slices) {
      const a = document.createElement("a");
      a.href = "#";
      const isSlice = state.page === "slice" && state.sliceNumber === s.slice_number;
      a.className = "dash-nav-link" + (isSlice ? " dash-nav-link--active" : "");
      a.textContent = `Slice ${String(s.slice_number).padStart(4, "0")}`;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        state.page = "slice";
        state.sliceNumber = s.slice_number;
        state.subpage = state.subpage || "physicalplan";
        PushUrl();
        void RefreshActivePage();
      });
      pb.appendChild(a);
      if (isSlice) {
        const sub = document.createElement("div");
        sub.className = "dash-subnav";
        for (const sp of ["physicalplan", "issues"]) {
          const a = document.createElement("a");
          a.href = "#";
          a.className =
            "dash-nav-link" + (state.subpage === sp ? " dash-nav-link--active" : "");
          a.textContent = sp === "physicalplan" ? "Physical plan" : "Issues";
          a.addEventListener("click", (ev) => {
            ev.preventDefault();
            state.subpage = sp;
            PushUrl();
            void RefreshActivePage();
          });
          sub.appendChild(a);
        }
        pb.appendChild(sub);
      }
    }
  } else {
    pb.innerHTML = `<p class="dash-empty">Select a quest</p>`;
  }
  pPanel.appendChild(pb);
  layout.appendChild(pPanel);
  const mainPanel = document.createElement("div");
  mainPanel.className = "dash-panel dash-panel--main";
  const main = document.createElement("div");
  main.className =
    "dash-main" +
    (state.page === "diffs" || state.page === "agents" || state.page === "slice"
      ? " dash-main--wide"
      : "");
  if (state.questType == null) {
    main.innerHTML = `<p class="dash-empty">Select a quest from the tree.</p>`;
  } else {
    switch (state.page) {
      case "overview":
        RenderOverview(main);
        break;
      case "human":
        RenderHuman(main);
        break;
      case "diffs":
        RenderDiffs(main);
        break;
      case "agents":
        RenderAgentsPanel({
          main,
          head: `<header class="dash-page-head"><h1>Agents</h1><p class="dash-page-meta">Agent step logs across the full quest.</p></header>`,
          steps: state.contentCache.agentSteps?.steps || [],
          emptyText: "No agent step logs for this quest yet.",
        });
        break;
      case "physicalplan":
        RenderPhysicalPlan(main);
        break;
      case "slice":
        RenderSlice(main);
        break;
      default:
        main.textContent = "";
    }
  }
  mainPanel.appendChild(main);
  layout.appendChild(mainPanel);
  root.appendChild(layout);
  RenderCreateQuestModal(root);
}

async function Init() {
  state.questTreeCollapsed = ReadBoolLs(x_COLLAPSE_QUEST, false);
  state.pageNavCollapsed = ReadBoolLs(x_COLLAPSE_PAGE, false);
  document.addEventListener(
    "focusin",
    (ev) => {
      const target = ev.target;
      if (target instanceof HTMLElement && target.closest("select, input, textarea")) {
        PauseAutoRefresh();
      }
    },
    true
  );
  document.addEventListener(
    "pointerdown",
    (ev) => {
      const target = ev.target;
      if (
        target instanceof HTMLElement &&
        target.closest("select, input, textarea, button, a")
      ) {
        PauseAutoRefresh();
      }
    },
    true
  );
  try {
    await LoadProjects();
  } catch (e) {
    state.lastError = String(e.message || e);
    render();
    return;
  }
  await LoadSnapshot();
  EnsureQuestSelected();
  PushUrl();
  await RefreshActivePage();
  StartScheduler();
}

void Init();
