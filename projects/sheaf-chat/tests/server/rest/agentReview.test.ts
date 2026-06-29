import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { WebSocket, WebSocketServer } from "ws";

import { SetAgentReviewGitHookForTests } from "../../../src/server/agentReview/git.js";
import { WithFakeRepoAsync } from "../../agents/modelRegistry/helpers.js";
import {
  CreateWorkspaceChatViaApi,
  RequestJson,
  StartTestServer,
  type TestServerHandle,
  WithTestServer,
} from "./helpers.js";

const ExecFile = promisify(execFile);

function WsUrl(baseUrl: string, repoId: string, workspaceId: string): string
{
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/agent-review";
  url.search = "";
  url.searchParams.set("repo", repoId);
  url.searchParams.set("workspace", workspaceId);
  url.searchParams.set("client", "test-client");
  return url.toString();
}

function CaptureConsoleError(): { lines: string[]; restore: () => void }
{
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) =>
  {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    lines,
    restore: () =>
    {
      console.error = original;
    },
  };
}

function ParseServerLog(line: string): Record<string, unknown>
{
  return JSON.parse(line) as Record<string, unknown>;
}

async function CloseSocket(socket: WebSocket): Promise<void>
{
  if (socket.readyState === WebSocket.CLOSED)
  {
    return;
  }

  await new Promise<void>((resolve) =>
  {
    const timer = setTimeout(() =>
    {
      socket.terminate();
      resolve();
    }, 1000);
    socket.once("close", () =>
    {
      clearTimeout(timer);
      resolve();
    });
    if (socket.readyState === WebSocket.OPEN)
    {
      socket.close();
    }
    else
    {
      socket.terminate();
    }
  });
}

function WaitForFrame(socket: WebSocket, type: string, timeoutMs = 5000): Promise<Record<string, any>>
{
  return new Promise((resolve, reject) =>
  {
    const timer = setTimeout(() =>
    {
      socket.off("message", onMessage);
      reject(new Error(`timed out waiting for Agent Review frame: ${type}`));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void =>
    {
      const frame = JSON.parse(raw.toString()) as Record<string, any>;
      if (frame.type !== type)
      {
        return;
      }
      socket.off("message", onMessage);
      clearTimeout(timer);
      resolve(frame);
    };
    socket.on("message", onMessage);
    socket.once("error", (error) =>
    {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function WaitForFrameWhere(
  socket: WebSocket,
  type: string,
  predicate: (frame: Record<string, any>) => boolean,
  label = type,
  timeoutMs = 5000,
): Promise<Record<string, any>>
{
  return new Promise((resolve, reject) =>
  {
    const timer = setTimeout(() =>
    {
      socket.off("message", onMessage);
      reject(new Error(`timed out waiting for matching Agent Review frame: ${label}`));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void =>
    {
      const frame = JSON.parse(raw.toString()) as Record<string, any>;
      if (frame.type !== type || !predicate(frame))
      {
        return;
      }
      socket.off("message", onMessage);
      clearTimeout(timer);
      resolve(frame);
    };
    socket.on("message", onMessage);
    socket.once("error", (error) =>
    {
      clearTimeout(timer);
      reject(error);
    });
  });
}

class FakeDictatorRPCServer
{
  readonly server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  socket: WebSocket | null = null;
  insertedText: string | null = null;
  connectionCount = 0;
  private readonly requests: Array<Record<string, any>> = [];
  private readonly failures = new Map<string, Array<{ code?: string; message: string }>>();
  private readonly waiters: Array<{
    method: string;
    predicate?: (request: Record<string, any>) => boolean;
    resolve: (request: Record<string, any>) => void;
  }> = [];

  async start(): Promise<number>
  {
    this.server.on("connection", (socket) =>
    {
      this.connectionCount += 1;
      this.socket = socket;
      socket.send(JSON.stringify({
        method: "rpc.hello",
        params: {
          protocolVersion: 1,
          capabilities: ["launchpad.cells", "cursor.insertText", "dictationContext"],
        },
      }));
      socket.on("message", (raw) =>
      {
        const request = JSON.parse(raw.toString()) as Record<string, any>;
        this.requests.push(request);
        if (request.method === "cursor.insertText")
        {
          this.insertedText = request.params.text;
        }
        const failure = this.failures.get(request.method)?.shift();
        if (failure !== undefined)
        {
          socket.send(JSON.stringify({ id: request.id, error: failure }));
        }
        else
        {
          socket.send(JSON.stringify({ id: request.id, result: { ok: true } }));
        }
        this.resolveWaiter(request);
      });
    });

    await new Promise<void>((resolve) => this.server.once("listening", resolve));
    const address = this.server.address();
    assert.ok(address !== null && typeof address === "object");
    return address.port;
  }

  async close(): Promise<void>
  {
    for (const client of this.server.clients)
    {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  sendPress(x = 3, y = 3): void
  {
    this.socket?.send(JSON.stringify({
      method: "launchpad.cellPressed",
      params: { x, y, sequence: 1 },
    }));
  }

  lastRequest(method: string): Record<string, any> | undefined
  {
    for (let i = this.requests.length - 1; i >= 0; i -= 1)
    {
      if (this.requests[i]!.method === method)
      {
        return this.requests[i];
      }
    }
    return undefined;
  }

  failNextRequest(method: string, error: { code?: string; message: string }): void
  {
    const failures = this.failures.get(method) ?? [];
    failures.push(error);
    this.failures.set(method, failures);
  }

  waitForRequest(method: string, timeoutMs = 5000): Promise<Record<string, any>>
  {
    return this.waitForRequestWhere(method, undefined, timeoutMs);
  }

  // Resolve with the next (or already-seen) request for `method` that also
  // satisfies `predicate`. Use clearRequests() first to wait for a request that
  // happens strictly after a known point.
  waitForRequestWhere(
    method: string,
    predicate?: (request: Record<string, any>) => boolean,
    timeoutMs = 5000,
  ): Promise<Record<string, any>>
  {
    const existing = this.requests.find(
      (request) => request.method === method && (predicate === undefined || predicate(request)),
    );
    if (existing !== undefined)
    {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) =>
    {
      const timer = setTimeout(() =>
      {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === wrapped);
        if (index >= 0)
        {
          this.waiters.splice(index, 1);
        }
        reject(new Error(`timed out waiting for Dictator RPC request: ${method}`));
      }, timeoutMs);
      const wrapped = (request: Record<string, any>): void =>
      {
        clearTimeout(timer);
        resolve(request);
      };
      this.waiters.push({ method, predicate, resolve: wrapped });
    });
  }

  clearRequests(): void
  {
    this.requests.length = 0;
  }

  private resolveWaiter(request: Record<string, any>): void
  {
    const index = this.waiters.findIndex(
      (waiter) =>
        waiter.method === request.method &&
        (waiter.predicate === undefined || waiter.predicate(request)),
    );
    if (index < 0)
    {
      return;
    }
    const [waiter] = this.waiters.splice(index, 1);
    waiter.resolve(request);
  }
}

async function Git(cwd: string, args: string[]): Promise<string>
{
  const result = await ExecFile("git", args, { cwd });
  return result.stdout;
}

function SeededInt(seed: number): () => number
{
  let value = seed >>> 0;
  return () =>
  {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value;
  };
}

type StateMachineEditKind = "replace" | "insert" | "delete";

interface StateMachineEdit
{
  id: string;
  fileRel: string;
  kind: StateMachineEditKind;
  anchor: number;
  order: number;
  before: string[];
  after: string[];
  description: string;
  initialIndexAfter: boolean;
  initialWorktreeAfter: boolean;
}

interface StateMachineEditStatus
{
  indexAfter: boolean;
  worktreeAfter: boolean;
}

interface StateMachineFile
{
  fileRel: string;
  baseLines: string[];
}

interface StateMachineUndoEntry
{
  statuses: Map<string, StateMachineEditStatus>;
  rejectedEditIds: Set<string>;
}

interface StateMachineFixture
{
  repoId: string;
  workspaceId: string;
  repoRoot: string;
  files: StateMachineFile[];
  edits: StateMachineEdit[];
  statuses: Map<string, StateMachineEditStatus>;
  rejectedEditIds: Set<string>;
  undoStack: StateMachineUndoEntry[];
  summary: string;
}

type StateMachineOperationKind =
  | "nextHunk"
  | "previousHunk"
  | "nextFile"
  | "previousFile"
  | "stage"
  | "revert"
  | "undo"
  | "focus"
  | "staleStage"
  | "staleRevert";

interface StateMachineOperation
{
  kind: StateMachineOperationKind;
  target?: Record<string, any>;
}

interface StateMachineContext
{
  seed: number;
  step: number;
  operation: string;
}

function StateMachineLabel(context: StateMachineContext, detail: string): string
{
  return `seed=${context.seed} step=${context.step} op=${context.operation}: ${detail}`;
}

function CloneStatuses(
  statuses: Map<string, StateMachineEditStatus>,
): Map<string, StateMachineEditStatus>
{
  return new Map(
    Array.from(statuses.entries()).map(([id, status]) => [
      id,
      { indexAfter: status.indexAfter, worktreeAfter: status.worktreeAfter },
    ]),
  );
}

function StateMachineEditToken(editId: string): string
{
  return `[edit:${editId}]`;
}

function RenderStateMachineFile(
  fixture: Pick<StateMachineFixture, "edits" | "statuses">,
  file: StateMachineFile,
  side: "index" | "worktree",
): string
{
  const insertions = new Map<number, StateMachineEdit[]>();
  const directEdits = new Map<number, StateMachineEdit>();
  for (const edit of fixture.edits.filter((candidate) => candidate.fileRel === file.fileRel))
  {
    if (edit.kind === "insert")
    {
      const existing = insertions.get(edit.anchor) ?? [];
      existing.push(edit);
      insertions.set(edit.anchor, existing);
    }
    else
    {
      directEdits.set(edit.anchor, edit);
    }
  }

  const lines: string[] = [];
  const emitInsertions = (anchor: number): void =>
  {
    const ordered = (insertions.get(anchor) ?? []).slice().sort((left, right) => left.order - right.order);
    for (const edit of ordered)
    {
      const status = fixture.statuses.get(edit.id);
      assert.ok(status, `missing edit status for ${edit.id}`);
      const useAfter = side === "index" ? status.indexAfter : status.worktreeAfter;
      if (useAfter)
      {
        lines.push(...edit.after);
      }
    }
  };

  for (let index = 0; index < file.baseLines.length; index += 1)
  {
    emitInsertions(index);
    const edit = directEdits.get(index);
    if (edit === undefined)
    {
      lines.push(file.baseLines[index]!);
      continue;
    }
    const status = fixture.statuses.get(edit.id);
    assert.ok(status, `missing edit status for ${edit.id}`);
    const useAfter = side === "index" ? status.indexAfter : status.worktreeAfter;
    lines.push(...(useAfter ? edit.after : edit.before));
  }
  emitInsertions(file.baseLines.length);

  return `${lines.join("\n")}\n`;
}

function ActiveStateMachineEdits(fixture: StateMachineFixture): StateMachineEdit[]
{
  return fixture.edits.filter((edit) =>
  {
    const status = fixture.statuses.get(edit.id);
    return status !== undefined && status.indexAfter !== status.worktreeAfter;
  });
}

function EditIdsForHunk(fixture: StateMachineFixture, hunk: Record<string, any> | null | undefined): string[]
{
  const patch = typeof hunk?.patch === "string" ? hunk.patch : "";
  const changedPatchText = patch.split("\n")
    .filter((line) =>
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---"))
    )
    .join("\n");
  return fixture.edits
    .filter((edit) => changedPatchText.includes(StateMachineEditToken(edit.id)))
    .map((edit) => edit.id);
}

function ObservedChangedText(state: Record<string, any>): string
{
  const parts: string[] = [];
  for (const file of state.inlineFiles ?? [])
  {
    for (const row of file.rows ?? [])
    {
      if (row.kind === "addition" || row.kind === "deletion")
      {
        parts.push(String(row.text ?? ""));
      }
    }
  }
  return parts.join("\n");
}

function StateMachineHunkSummary(
  fixture: StateMachineFixture,
  hunk: Record<string, any> | null | undefined,
): string
{
  if (hunk === null || hunk === undefined)
  {
    return "none";
  }
  return [
    `file=${String(hunk.file)}`,
    `index=${String(hunk.hunkIndex)}`,
    `hash=${String(hunk.patchHash).slice(0, 12)}`,
    `edits=${EditIdsForHunk(fixture, hunk).join(",") || "none"}`,
  ].join(" ");
}

function ApplyStateMachineMutation(
  fixture: StateMachineFixture,
  action: "stage" | "revert",
  editIds: string[],
): void
{
  fixture.undoStack.push({
    statuses: CloneStatuses(fixture.statuses),
    rejectedEditIds: new Set(fixture.rejectedEditIds),
  });
  for (const editId of editIds)
  {
    const status = fixture.statuses.get(editId);
    assert.ok(status, `missing edit status for ${editId}`);
    if (action === "stage")
    {
      status.indexAfter = status.worktreeAfter;
      fixture.rejectedEditIds.delete(editId);
    }
    else
    {
      status.worktreeAfter = status.indexAfter;
      fixture.rejectedEditIds.add(editId);
    }
  }
}

function UndoStateMachineMutation(fixture: StateMachineFixture): boolean
{
  const prior = fixture.undoStack.pop();
  if (prior === undefined)
  {
    return false;
  }
  fixture.statuses = CloneStatuses(prior.statuses);
  fixture.rejectedEditIds = new Set(prior.rejectedEditIds);
  return true;
}

async function GitExit(cwd: string, args: string[]): Promise<number>
{
  try
  {
    await ExecFile("git", args, { cwd });
    return 0;
  }
  catch (error)
  {
    const maybe = error as { code?: unknown };
    return typeof maybe.code === "number" ? maybe.code : 1;
  }
}

async function GitHasDiff(cwd: string, args: string[]): Promise<boolean>
{
  const code = await GitExit(cwd, ["diff", "--quiet", ...args]);
  return code === 1;
}

function ParseStateMachineNumberList(value: string | undefined, fallback: number[]): number[]
{
  if (value === undefined || value.trim() === "")
  {
    return fallback;
  }
  return value.split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
}

function StateMachineStepCount(): number
{
  const parsed = Number(process.env.SHEAF_AGENT_REVIEW_STATE_MACHINE_STEPS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 64;
}

function StateMachineSeeds(): number[]
{
  const stressCount = Number(process.env.SHEAF_AGENT_REVIEW_STATE_MACHINE_STRESS_SEEDS);
  if (Number.isFinite(stressCount) && stressCount > 0)
  {
    return Array.from({ length: Math.floor(stressCount) }, (_, index) => 0x51ea + index * 7919);
  }
  return ParseStateMachineNumberList(
    process.env.SHEAF_AGENT_REVIEW_STATE_MACHINE_SEEDS,
    [0x51ea, 0xc0de, 0x5eed, 0x0ace, 0xbeef, 0x1337],
  );
}

async function CreateStateMachineReviewSession(
  handle: TestServerHandle,
  seed: number,
): Promise<StateMachineFixture>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo", `state-machine-${seed}`);
  const next = SeededInt(seed);
  const fileCount = 2 + (next() % 2);
  const files: StateMachineFile[] = [];
  const edits: StateMachineEdit[] = [];
  let order = 0;

  const addEdit = (edit: Omit<StateMachineEdit, "order">): void =>
  {
    edits.push({ ...edit, order: order++ });
  };

  await mkdir(demoRoot, { recursive: true });
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);

  for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1)
  {
    const fileRel = `projects/demo/state-machine-${seed}/file-${fileIndex}.ts`;
    const baseLines = Array.from(
      { length: 90 },
      (_, lineIndex) => `seed ${seed} file ${fileIndex} base ${lineIndex + 1}`,
    );
    files.push({ fileRel, baseLines });
    await writeFile(path.join(repoRoot, fileRel), `${baseLines.join("\n")}\n`, "utf8");

    const stagedReplaceAnchor = 4 + (next() % 3);
    addEdit({
      id: `s${seed}-f${fileIndex}-staged-replace`,
      fileRel,
      kind: "replace",
      anchor: stagedReplaceAnchor,
      before: [baseLines[stagedReplaceAnchor]!],
      after: [`staged replacement seed ${seed} file ${fileIndex}`],
      description: "staged replacement",
      initialIndexAfter: true,
      initialWorktreeAfter: true,
    });
    const partialInsertionAnchors = [2, 3, 86, 87];
    const partialInsertionAnchor = partialInsertionAnchors[next() % partialInsertionAnchors.length]!;
    const stagedInsertId = `s${seed}-f${fileIndex}-staged-insert`;
    addEdit({
      id: stagedInsertId,
      fileRel,
      kind: "insert",
      anchor: partialInsertionAnchor,
      before: [],
      after: [
        `staged inserted helper ${StateMachineEditToken(stagedInsertId)}`,
        `staged inserted helper tail ${StateMachineEditToken(stagedInsertId)}`,
      ],
      description: "staged insertion",
      initialIndexAfter: true,
      initialWorktreeAfter: true,
    });

    const largeInsertId = `s${seed}-f${fileIndex}-large-insert`;
    addEdit({
      id: largeInsertId,
      fileRel,
      kind: "insert",
      anchor: partialInsertionAnchor,
      before: [],
      after: Array.from(
        { length: 12 + (next() % 5) },
        (_, lineIndex) => `large inserted block ${lineIndex} ${StateMachineEditToken(largeInsertId)}`,
      ),
      description: "large insert block before later edits",
      initialIndexAfter: false,
      initialWorktreeAfter: true,
    });

    const replaceId = `s${seed}-f${fileIndex}-replace`;
    addEdit({
      id: replaceId,
      fileRel,
      kind: "replace",
      anchor: 16 + (next() % 3),
      before: [`semantic replace before ${StateMachineEditToken(replaceId)}`],
      after: [`duplicate changed text ${StateMachineEditToken(replaceId)}`],
      description: "duplicate-content replacement",
      initialIndexAfter: false,
      initialWorktreeAfter: true,
    });

    const closeInsertId = `s${seed}-f${fileIndex}-close-insert`;
    addEdit({
      id: closeInsertId,
      fileRel,
      kind: "insert",
      anchor: 21 + (next() % 2),
      before: [],
      after: [`nearby inserted setup ${StateMachineEditToken(closeInsertId)}`],
      description: "close sibling insertion",
      initialIndexAfter: false,
      initialWorktreeAfter: true,
    });

    const deleteId = `s${seed}-f${fileIndex}-delete`;
    addEdit({
      id: deleteId,
      fileRel,
      kind: "delete",
      anchor: 32 + (next() % 4),
      before: [`semantic delete before ${StateMachineEditToken(deleteId)}`],
      after: [],
      description: "pure deletion",
      initialIndexAfter: false,
      initialWorktreeAfter: true,
    });

    const tailId = `s${seed}-f${fileIndex}-tail`;
    addEdit({
      id: tailId,
      fileRel,
      kind: "replace",
      anchor: 72 + (next() % 5),
      before: [`semantic tail before ${StateMachineEditToken(tailId)}`],
      after: [`semantic tail after ${StateMachineEditToken(tailId)}`],
      description: "tail replacement",
      initialIndexAfter: false,
      initialWorktreeAfter: true,
    });
  }

  const initialStatuses = new Map<string, StateMachineEditStatus>();
  const baseStatuses = new Map<string, StateMachineEditStatus>();
  for (const edit of edits)
  {
    initialStatuses.set(edit.id, {
      indexAfter: edit.initialIndexAfter,
      worktreeAfter: edit.initialWorktreeAfter,
    });
    baseStatuses.set(edit.id, {
      indexAfter: false,
      worktreeAfter: false,
    });
  }

  const fixture: StateMachineFixture = {
    ...created,
    repoRoot,
    files,
    edits,
    statuses: baseStatuses,
    rejectedEditIds: new Set(),
    undoStack: [],
    summary: `seed ${seed}: ${files.length} files, ${edits.length} semantic edits`,
  };

  for (const file of files)
  {
    await writeFile(path.join(repoRoot, file.fileRel), RenderStateMachineFile(fixture, file, "index"), "utf8");
  }
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", `state-machine ${seed} base`]);

  fixture.statuses = initialStatuses;
  for (const file of files)
  {
    await writeFile(path.join(repoRoot, file.fileRel), RenderStateMachineFile(fixture, file, "index"), "utf8");
  }
  await Git(repoRoot, ["add", "."]);

  for (const file of files)
  {
    await writeFile(path.join(repoRoot, file.fileRel), RenderStateMachineFile(fixture, file, "worktree"), "utf8");
  }

  return fixture;
}

async function ConnectAgentReviewSocket(
  baseUrl: string,
  repoId: string,
  workspaceId: string,
): Promise<WebSocket>
{
  const socket = new WebSocket(WsUrl(baseUrl, repoId, workspaceId));
  socket.setMaxListeners(100);
  await new Promise<void>((resolve, reject) =>
  {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

async function AssertStateMachineOracle(
  fixture: StateMachineFixture,
  state: Record<string, any>,
  context: StateMachineContext,
): Promise<void>
{
  const active = ActiveStateMachineEdits(fixture);
  const activeIds = new Set(active.map((edit) => edit.id));
  const patchText = ObservedChangedText(state);

  for (const edit of fixture.edits)
  {
    const tokenPresent = patchText.includes(StateMachineEditToken(edit.id));
    assert.equal(
      tokenPresent,
      activeIds.has(edit.id),
      StateMachineLabel(context, `hunk token presence for ${edit.id}; fixture=${fixture.summary}`),
    );
  }

  if (active.length === 0)
  {
    assert.equal(state.currentHunk, null, StateMachineLabel(context, "no active edits should leave no current hunk"));
  }
  if (state.currentHunk !== null)
  {
    const currentEditIds = EditIdsForHunk(fixture, state.currentHunk);
    assert.ok(
      currentEditIds.length > 0 && currentEditIds.every((editId) => activeIds.has(editId)),
      StateMachineLabel(context, `current hunk maps to active edits ${StateMachineHunkSummary(fixture, state.currentHunk)}`),
    );
  }
  assert.equal(
    Boolean(state.actions?.canUndo),
    fixture.undoStack.length > 0,
    StateMachineLabel(context, "undo availability"),
  );
  assert.equal(Boolean(state.actions?.canStage), state.currentHunk !== null, StateMachineLabel(context, "stage availability"));
  assert.equal(Boolean(state.actions?.canRevert), state.currentHunk !== null, StateMachineLabel(context, "revert availability"));

  const rejectedMarkers = new Set<string>();
  for (const entry of state.reviewDraft?.entries ?? [])
  {
    if (entry?.kind !== "rejected")
    {
      continue;
    }
    for (const editId of EditIdsForHunk(fixture, entry.hunk))
    {
      rejectedMarkers.add(editId);
    }
  }
  assert.deepEqual(
    Array.from(rejectedMarkers).sort(),
    Array.from(fixture.rejectedEditIds).sort(),
    StateMachineLabel(context, "rejected marker edit ids"),
  );

  for (const file of fixture.files)
  {
    const expectedIndex = RenderStateMachineFile(fixture, file, "index");
    const expectedWorktree = RenderStateMachineFile(fixture, file, "worktree");
    const actualIndex = await Git(fixture.repoRoot, ["show", `:${file.fileRel}`]);
    const actualWorktree = await readFile(path.join(fixture.repoRoot, file.fileRel), "utf8");
    assert.equal(actualIndex, expectedIndex, StateMachineLabel(context, `index content ${file.fileRel}`));
    assert.equal(actualWorktree, expectedWorktree, StateMachineLabel(context, `worktree content ${file.fileRel}`));

    const shouldHaveStagedDiff = expectedIndex !== file.baseLines.join("\n") + "\n";
    const shouldHaveUnstagedDiff = expectedIndex !== expectedWorktree;
    assert.equal(
      await GitHasDiff(fixture.repoRoot, ["--cached", "--", file.fileRel]),
      shouldHaveStagedDiff,
      StateMachineLabel(context, `staged diff presence ${file.fileRel}`),
    );
    assert.equal(
      await GitHasDiff(fixture.repoRoot, ["--", file.fileRel]),
      shouldHaveUnstagedDiff,
      StateMachineLabel(context, `unstaged diff presence ${file.fileRel}`),
    );
  }
}

function ChooseStateMachineOperation(
  fixture: StateMachineFixture,
  state: Record<string, any>,
  staleTargets: Record<string, any>[],
  next: () => number,
): StateMachineOperation
{
  const operations: StateMachineOperation[] = [
    { kind: "nextHunk" },
    { kind: "previousHunk" },
    { kind: "nextFile" },
    { kind: "previousFile" },
  ];
  if (state.currentHunk !== null)
  {
    operations.push({ kind: "stage", target: state.currentHunk });
    operations.push({ kind: "revert", target: state.currentHunk });
  }
  if ((state.hunks ?? []).length > 0)
  {
    const hunks = state.hunks as Record<string, any>[];
    operations.push({ kind: "focus", target: hunks[next() % hunks.length] });
  }
  operations.push({ kind: "undo" });
  const currentHunkIds = new Set(
    Array.isArray(state.hunks)
      ? (state.hunks as Record<string, any>[]).map((hunk) => String(hunk.hunkId))
      : [],
  );
  const staleCandidates = staleTargets.filter((target) => !currentHunkIds.has(String(target.hunkId)));
  if (state.currentHunk !== null && staleCandidates.length > 0)
  {
    const target = staleCandidates[next() % staleCandidates.length]!;
    operations.push({ kind: "staleStage", target });
    operations.push({ kind: "staleRevert", target });
  }

  // Bias toward mutations once the generator has exposed active edits, while
  // keeping navigation/focus/stale paths in the random walk.
  const activeCount = ActiveStateMachineEdits(fixture).length;
  if (activeCount > 0 && state.currentHunk !== null)
  {
    operations.push({ kind: "stage", target: state.currentHunk });
    operations.push({ kind: "revert", target: state.currentHunk });
  }

  return operations[next() % operations.length]!;
}

async function ExecuteStateMachineOperation(
  socket: WebSocket,
  fixture: StateMachineFixture,
  state: Record<string, any>,
  operation: StateMachineOperation,
  context: StateMachineContext,
  staleTargets: Record<string, any>[],
): Promise<Record<string, any>>
{
  const id = `state-machine-${context.seed}-${context.step}-${operation.kind}`;
  if (operation.kind === "focus")
  {
    socket.send(JSON.stringify({
      type: "focus",
      hunkId: operation.target?.hunkId ?? null,
      file: operation.target?.file ?? null,
    }));
    const focused = await WaitForFrame(socket, "state");
    return focused.state;
  }

  const action = operation.kind === "staleStage"
    ? "stage"
    : operation.kind === "staleRevert"
      ? "revert"
      : operation.kind;
  const target = operation.target ?? state.currentHunk;
  const expectStale = operation.kind === "staleStage" || operation.kind === "staleRevert";
  const expectUndoFailure = operation.kind === "undo" && fixture.undoStack.length === 0;
  const expectNoHunksNavigationFailure =
    (operation.kind === "nextHunk" ||
      operation.kind === "previousHunk" ||
      operation.kind === "nextFile" ||
      operation.kind === "previousFile") &&
    (state.hunks ?? []).length === 0;
  const targetEditIds = target === null || target === undefined ? [] : EditIdsForHunk(fixture, target);

  socket.send(JSON.stringify({
    type: "command",
    id,
    action,
    hunkId: target?.hunkId,
    patchHash: target?.patchHash,
  }));
  const frame = await WaitForFrame(socket, "command_result");
  assert.equal(frame.result.action, action, StateMachineLabel(context, "command action"));

  if (expectStale)
  {
    assert.equal(frame.result.ok, false, StateMachineLabel(context, `stale command should fail ${StateMachineHunkSummary(fixture, target)}`));
    assert.equal(frame.result.stale, true, StateMachineLabel(context, "stale command flag"));
    return frame.state;
  }

  if (expectUndoFailure)
  {
    assert.equal(frame.result.ok, false, StateMachineLabel(context, "unavailable undo should fail"));
    return frame.state;
  }

  if (expectNoHunksNavigationFailure)
  {
    assert.equal(frame.result.ok, false, StateMachineLabel(context, "navigation without hunks should fail"));
    return frame.state;
  }

  assert.equal(
    frame.result.ok,
    true,
    StateMachineLabel(
      context,
      `command should succeed result=${JSON.stringify(frame.result)} target=${StateMachineHunkSummary(fixture, target)}`,
    ),
  );

  if (action === "stage" || action === "revert")
  {
    assert.ok(
      targetEditIds.length > 0,
      StateMachineLabel(context, `mutation target should map to semantic edits ${StateMachineHunkSummary(fixture, target)}`),
    );
    ApplyStateMachineMutation(fixture, action, targetEditIds);
    staleTargets.push(target);
  }
  else if (action === "undo")
  {
    assert.equal(UndoStateMachineMutation(fixture), true, StateMachineLabel(context, "oracle undo should be available"));
  }

  return frame.state;
}

async function CreateSeededMixedIndexReviewSession(
  handle: TestServerHandle,
  seed: number,
): Promise<{ repoId: string; workspaceId: string; repoRoot: string; fileRel: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const fileRel = `projects/demo/random-${seed}.ts`;
  const filePath = path.join(repoRoot, fileRel);
  const next = SeededInt(seed);
  const base = Array.from({ length: 48 }, (_, index) => `seed ${seed} base ${index + 1}`);

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", fileRel]);
  await Git(repoRoot, ["commit", "-m", `seed ${seed} base`]);

  const staged = base.slice();
  staged[1 + (next() % 4)] = "duplicate changed text";
  staged.splice(34 + (next() % 4), 0, `seed ${seed} staged insert`);
  await writeFile(filePath, `${staged.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", fileRel]);

  const changed = staged.slice();
  const first = 8 + (next() % 3);
  const second = 20 + (next() % 3);
  const third = 40 + (next() % 3);
  changed[first] = "duplicate changed text";
  changed.splice(second, 0, `seed ${seed} unstaged inserted sibling`);
  changed[third] = `seed ${seed} tail changed`;
  await writeFile(filePath, `${changed.join("\n")}\n`, "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId, repoRoot, fileRel };
}

async function CreateGitReviewSession(
  handle: TestServerHandle,
): Promise<{
  repoId: string;
  workspaceId: string;
  chatId: string;
  repoRoot: string;
  filePath: string;
}>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const filePath = path.join(demoRoot, "app.ts");

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, "one\ntwo\nthree\n", "utf8");
  await Git(repoRoot, ["add", "projects/demo/app.ts"]);
  await Git(repoRoot, ["commit", "-m", "initial"]);
  await writeFile(filePath, "one\ntwo changed\nthree\n", "utf8");

  return { ...created, repoRoot, filePath };
}

async function CreateSeparatedReviewSession(
  handle: TestServerHandle,
): Promise<{
  repoId: string;
  workspaceId: string;
  repoRoot: string;
  filePath: string;
}>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const filePath = path.join(demoRoot, "app.ts");

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, "line 1\nline 2\nline 3\nline 4\nline 5\n", "utf8");
  await Git(repoRoot, ["add", "projects/demo/app.ts"]);
  await Git(repoRoot, ["commit", "-m", "initial"]);
  await writeFile(filePath, "line 1\nline 2 changed\nline 3\nline 4 changed\nline 5\n", "utf8");

  return { ...created, repoRoot, filePath };
}

async function CreateTrailingNewlineReviewSession(
  handle: TestServerHandle,
): Promise<{
  repoId: string;
  workspaceId: string;
  repoRoot: string;
  filePath: string;
}>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const filePath = path.join(demoRoot, "trailing.ts");

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, "line 1\n};", "utf8");
  await Git(repoRoot, ["add", "projects/demo/trailing.ts"]);
  await Git(repoRoot, ["commit", "-m", "initial"]);
  await writeFile(filePath, "line 1\n};\n", "utf8");

  return { ...created, repoRoot, filePath };
}

test("Agent Review availability reports Git hunks under the workspace root", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateGitReviewSession(handle);
    const response = await RequestJson(
      handle.baseUrl,
      "GET",
      `/api/repositories/${encodeURIComponent(repoId)}/workspaces/${encodeURIComponent(workspaceId)}/agent-review`,
    );

    assert.equal(response.status, 200);
    const body = response.body as {
      available: boolean;
      currentHunk: { sourceProvider: string; file: string; hunkId: string; patch: string } | null;
      files: Array<{ file: string; hunkCount: number }>;
      inlineFiles: Array<{
        file: string;
        rows: Array<{ kind: string; text: string; hunkId?: string }>;
      }>;
      actions: { canStage: boolean; canRevert: boolean };
    };
    assert.equal(body.available, true);
    assert.equal(body.currentHunk?.sourceProvider, "sheaf-chat");
    assert.equal(body.currentHunk?.file, "projects/demo/app.ts");
    assert.match(body.currentHunk?.patch ?? "", /two changed/);
    assert.deepEqual(body.files, [{ file: "projects/demo/app.ts", hunkCount: 1 }]);
    assert.equal(body.inlineFiles[0]?.file, "projects/demo/app.ts");
    assert.ok(
      body.inlineFiles[0]?.rows.some((row) =>
        row.kind === "deletion" &&
        row.text === "two" &&
        row.hunkId === body.currentHunk?.hunkId,
      ),
      "expected deleted old line in inline review rows",
    );
    assert.ok(
      body.inlineFiles[0]?.rows.some((row) =>
        row.kind === "addition" &&
        row.text === "two changed" &&
        row.hunkId === body.currentHunk?.hunkId,
      ),
      "expected added new line in inline review rows",
    );
    assert.equal(body.actions.canStage, true);
    assert.equal(body.actions.canRevert, true);
  });
});

test("Agent Review inline documents place pure deletions after preceding context", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const repoRoot = handle.agentManager.storagePaths.repoRoot;
    const demoRoot = path.join(repoRoot, "projects/demo");
    const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
    const filePath = path.join(demoRoot, "boundary.cpp");

    await mkdir(demoRoot, { recursive: true });
    await Git(repoRoot, ["init"]);
    await Git(repoRoot, ["config", "user.email", "test@example.com"]);
    await Git(repoRoot, ["config", "user.name", "Test User"]);
    await writeFile(
      filePath,
      [
        "struct TheoryOfTime : public TheoryOfTimeBase",
        "{",
        "    Tick2Phasor m_tick2Phasor;",
        "    Phasor2Tick m_phasor2Tick;",
        "    SmartGrid::MessageOutBuffer* m_messageOutBuffer;",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await Git(repoRoot, ["add", "projects/demo/boundary.cpp"]);
    await Git(repoRoot, ["commit", "-m", "initial"]);
    await writeFile(
      filePath,
      [
        "struct TheoryOfTime : public TheoryOfTimeBase",
        "{",
        "    Phasor2Tick m_phasor2Tick;",
        "    SmartGrid::MessageOutBuffer* m_messageOutBuffer;",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const response = await RequestJson(
      handle.baseUrl,
      "GET",
      `/api/repositories/${encodeURIComponent(created.repoId)}/workspaces/${encodeURIComponent(created.workspaceId)}/agent-review`,
    );

    assert.equal(response.status, 200);
    const body = response.body as {
      inlineFiles: Array<{
        file: string;
        rows: Array<{
          kind: string;
          text: string;
          hunkId?: string;
          oldLineNumber?: number;
          newLineNumber?: number;
        }>;
      }>;
    };
    const inlineFile = body.inlineFiles.find((file) => file.file === "projects/demo/boundary.cpp");
    assert.ok(inlineFile, "expected boundary.cpp inline review document");

    const braceIndex = inlineFile.rows.findIndex((row) =>
      row.kind === "context" &&
      row.text === "{" &&
      row.newLineNumber === 2
    );
    const deletionIndex = inlineFile.rows.findIndex((row) =>
      row.kind === "deletion" &&
      row.text === "    Tick2Phasor m_tick2Phasor;" &&
      row.oldLineNumber === 3
    );
    const followingIndex = inlineFile.rows.findIndex((row) =>
      row.kind === "context" &&
      row.text === "    Phasor2Tick m_phasor2Tick;" &&
      row.newLineNumber === 3
    );

    assert.notEqual(braceIndex, -1, "expected opening brace context row");
    assert.notEqual(deletionIndex, -1, "expected deleted member row");
    assert.notEqual(followingIndex, -1, "expected following context row");
    assert.ok(
      braceIndex < deletionIndex,
      `expected deletion after opening brace; rows=${JSON.stringify(inlineFile.rows)}`,
    );
    assert.ok(
      deletionIndex < followingIndex,
      `expected deletion before following member; rows=${JSON.stringify(inlineFile.rows)}`,
    );
  });
});

test("Agent Review splits separated changed runs and keeps adjacent changes together", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const repoRoot = handle.agentManager.storagePaths.repoRoot;
    const demoRoot = path.join(repoRoot, "projects/demo");
    const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
    const separatedPath = path.join(demoRoot, "separated.ts");
    const adjacentPath = path.join(demoRoot, "adjacent.ts");

    await mkdir(demoRoot, { recursive: true });
    await Git(repoRoot, ["init"]);
    await Git(repoRoot, ["config", "user.email", "test@example.com"]);
    await Git(repoRoot, ["config", "user.name", "Test User"]);
    await writeFile(separatedPath, "line 1\nline 2\nline 3\nline 4\nline 5\n", "utf8");
    await writeFile(adjacentPath, "line 1\nline 2\nline 3\nline 4\n", "utf8");
    await Git(repoRoot, ["add", "."]);
    await Git(repoRoot, ["commit", "-m", "initial"]);
    await writeFile(separatedPath, "line 1\nline 2 changed\nline 3\nline 4 changed\nline 5\n", "utf8");
    await writeFile(adjacentPath, "line 1\nline 2 changed\nline 3 changed\nline 4\n", "utf8");

    const response = await RequestJson(
      handle.baseUrl,
      "GET",
      `/api/repositories/${encodeURIComponent(created.repoId)}/workspaces/${encodeURIComponent(created.workspaceId)}/agent-review`,
    );
    assert.equal(response.status, 200);
    const body = response.body as {
      files: Array<{ file: string; hunkCount: number }>;
      hunks: Array<{ file: string; patch: string }>;
      inlineFiles: Array<{
        file: string;
        rows: Array<{ kind: string; text: string; hunkId?: string }>;
      }>;
    };

    assert.deepEqual(body.files, [
      { file: "projects/demo/adjacent.ts", hunkCount: 1 },
      { file: "projects/demo/separated.ts", hunkCount: 2 },
    ]);
    const adjacentHunks = body.hunks.filter((hunk) => hunk.file === "projects/demo/adjacent.ts");
    const separatedHunks = body.hunks.filter((hunk) => hunk.file === "projects/demo/separated.ts");
    assert.equal(adjacentHunks.length, 1);
    assert.equal(separatedHunks.length, 2);
    assert.match(adjacentHunks[0]?.patch ?? "", /line 2 changed/);
    assert.match(adjacentHunks[0]?.patch ?? "", /line 3 changed/);
    assert.match(separatedHunks[0]?.patch ?? "", /line 2 changed/);
    assert.doesNotMatch(separatedHunks[0]?.patch ?? "", /line 4 changed/);
    assert.match(separatedHunks[1]?.patch ?? "", /line 4 changed/);
    assert.doesNotMatch(separatedHunks[1]?.patch ?? "", /line 2 changed/);

    const separatedInline = body.inlineFiles.find((file) => file.file === "projects/demo/separated.ts");
    assert.ok(separatedInline, "expected separated.ts inline file");
    assert.ok(
      separatedInline.rows.some((row) =>
        row.kind === "context" &&
        row.text === "line 3" &&
        row.hunkId === undefined,
      ),
      "expected unchanged line between hunks to remain ordinary context",
    );
  });
});

test("Agent Review WebSocket stages, reverts, and undoes current hunks", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot, filePath } =
      await CreateGitReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const hunk = bootstrap.state.currentHunk;
    assert.equal(hunk.file, "projects/demo/app.ts");

    const captured = CaptureConsoleError();
    let stage: Record<string, any> | null = null;
    try
    {
      socket.send(JSON.stringify({
        type: "command",
        id: "stage-1",
        action: "stage",
        hunkId: hunk.hunkId,
        patchHash: hunk.patchHash,
      }));
      stage = await WaitForFrame(socket, "command_result");
      assert.equal(stage.result.ok, true);
      assert.deepEqual(captured.lines, []);
    }
    finally
    {
      captured.restore();
    }
    assert.ok(stage);
    assert.equal(stage.state.reviewDraft.entries.length, 0);
    assert.equal(stage.state.inlineFiles.length, 0);
    assert.match(await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/app.ts"]), /two changed/);
    assert.equal((await Git(repoRoot, ["diff", "--", "projects/demo/app.ts"])).trim(), "");

    socket.send(JSON.stringify({ type: "command", id: "undo-stage", action: "undo" }));
    const undoStage = await WaitForFrame(socket, "command_result");
    assert.equal(undoStage.result.ok, true);
    assert.equal((await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/app.ts"])).trim(), "");
    assert.match(await Git(repoRoot, ["diff", "--", "projects/demo/app.ts"]), /two changed/);

    const stateAfterUndo = undoStage.state;
    const revertHunk = stateAfterUndo.currentHunk;
    socket.send(JSON.stringify({
      type: "command",
      id: "revert-1",
      action: "revert",
      hunkId: revertHunk.hunkId,
      patchHash: revertHunk.patchHash,
    }));
    const revert = await WaitForFrame(socket, "command_result");
    assert.equal(revert.result.ok, true);
    assert.equal(revert.state.reviewDraft.entries[0].kind, "rejected");
    assert.equal(revert.state.reviewDraft.entries[0].hunk.file, "projects/demo/app.ts");
    assert.equal(await readFile(filePath, "utf8"), "one\ntwo\nthree\n");

    socket.send(JSON.stringify({ type: "command", id: "undo-revert", action: "undo" }));
    const undoRevert = await WaitForFrame(socket, "command_result");
    assert.equal(undoRevert.result.ok, true);
    assert.equal(undoRevert.state.reviewDraft.entries.length, 0);
    assert.equal(await readFile(filePath, "utf8"), "one\ntwo changed\nthree\n");
  });
});

test("Agent Review mutates only the selected zero-context hunk", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot, filePath } =
      await CreateSeparatedReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const firstHunk = bootstrap.state.currentHunk;
    assert.equal(firstHunk.file, "projects/demo/app.ts");
    assert.equal(bootstrap.state.hunks.length, 2);
    assert.match(firstHunk.patch, /line 2 changed/);
    assert.doesNotMatch(firstHunk.patch, /line 4 changed/);

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-first",
      action: "stage",
      hunkId: firstHunk.hunkId,
      patchHash: firstHunk.patchHash,
    }));
    const stage = await WaitForFrame(socket, "command_result");
    assert.equal(stage.result.ok, true);
    assert.equal(stage.state.reviewDraft.entries.length, 0);
    const cachedAfterStage = await Git(repoRoot, [
      "diff",
      "--cached",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    const worktreeAfterStage = await Git(repoRoot, [
      "diff",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    assert.match(cachedAfterStage, /line 2 changed/);
    assert.doesNotMatch(cachedAfterStage, /line 4 changed/);
    assert.match(worktreeAfterStage, /line 4 changed/);
    assert.doesNotMatch(worktreeAfterStage, /line 2 changed/);

    socket.send(JSON.stringify({ type: "command", id: "undo-stage", action: "undo" }));
    const undoStage = await WaitForFrame(socket, "command_result");
    assert.equal(undoStage.result.ok, true);
    assert.equal((await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/app.ts"])).trim(), "");
    const worktreeAfterUndoStage = await Git(repoRoot, [
      "diff",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    assert.match(worktreeAfterUndoStage, /line 2 changed/);
    assert.match(worktreeAfterUndoStage, /line 4 changed/);

    socket.send(JSON.stringify({ type: "command", id: "next", action: "nextHunk" }));
    const next = await WaitForFrame(socket, "command_result");
    const secondHunk = next.state.currentHunk;
    assert.match(secondHunk.patch, /line 4 changed/);
    assert.doesNotMatch(secondHunk.patch, /line 2 changed/);

    socket.send(JSON.stringify({
      type: "command",
      id: "revert-second",
      action: "revert",
      hunkId: secondHunk.hunkId,
      patchHash: secondHunk.patchHash,
    }));
    const revert = await WaitForFrame(socket, "command_result");
    assert.equal(revert.result.ok, true);
    assert.equal(revert.state.reviewDraft.entries.length, 1);
    assert.equal(revert.state.reviewDraft.entries[0].kind, "rejected");
    assert.equal(
      await readFile(filePath, "utf8"),
      "line 1\nline 2 changed\nline 3\nline 4\nline 5\n",
    );

    socket.send(JSON.stringify({ type: "command", id: "undo-revert", action: "undo" }));
    const undoRevert = await WaitForFrame(socket, "command_result");
    assert.equal(undoRevert.result.ok, true);
    assert.equal(undoRevert.state.reviewDraft.entries.length, 0);
    assert.equal(
      await readFile(filePath, "utf8"),
      "line 1\nline 2 changed\nline 3\nline 4 changed\nline 5\n",
    );
  });
});

test("Agent Review stages a trailing-newline-only hunk", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot, filePath } =
      await CreateTrailingNewlineReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const hunk = bootstrap.state.currentHunk;
    assert.equal(hunk.file, "projects/demo/trailing.ts");
    assert.match(hunk.patch, /No newline at end of file/);

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-trailing-newline",
      action: "stage",
      hunkId: hunk.hunkId,
      patchHash: hunk.patchHash,
    }));
    const stage = await WaitForFrame(socket, "command_result");
    assert.equal(stage.result.ok, true);
    assert.equal((await Git(repoRoot, ["diff", "--", "projects/demo/trailing.ts"])).trim(), "");
    assert.match(
      await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/trailing.ts"]),
      /No newline at end of file/,
    );
    assert.equal(await readFile(filePath, "utf8"), "line 1\n};\n");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review rejects stale zero-context hunk mutations", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot } = await CreateSeparatedReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const hunk = bootstrap.state.currentHunk;
    const captured = CaptureConsoleError();
    try
    {
      socket.send(JSON.stringify({
        type: "command",
        id: "stale-stage",
        action: "stage",
        hunkId: hunk.hunkId,
        patchHash: "not-the-current-patch",
      }));
      const stale = await WaitForFrame(socket, "command_result");
      assert.equal(stale.result.ok, false);
      assert.equal(stale.result.stale, true);
      assert.match(stale.result.error, /patch changed/);
      assert.equal(captured.lines.length, 1);
      const log = ParseServerLog(captured.lines[0]!);
      assert.equal(log.service, "sheaf-chat");
      assert.equal(log.event, "sheaf_chat.handled_error");
      assert.equal(log.feature, "agent-review");
      assert.equal(log.action, "stage");
      assert.equal(log.commandId, "stale-stage");
      assert.equal(log.repoId, repoId);
      assert.equal(log.workspaceId, workspaceId);
      assert.equal(log.clientId, "test-client");
      assert.equal(log.stale, true);
      assert.match(String(log.message), /patch changed/);
      assert.equal(JSON.stringify(log).includes(hunk.patch), false);
    }
    finally
    {
      captured.restore();
    }
    assert.equal((await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/app.ts"])).trim(), "");
    const worktreeAfterStale = await Git(repoRoot, [
      "diff",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    assert.match(worktreeAfterStale, /line 2 changed/);
    assert.match(worktreeAfterStale, /line 4 changed/);

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review logs malformed WebSocket frames without leaking payloads", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );
      const { repoId, workspaceId } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });

      await WaitForFrame(socket, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");
      const captured = CaptureConsoleError();
      try
      {
        socket.send("{\"type\":\"command\",\"id\":\"bad-frame\",\"action\":\"stage\",\"patch\":\"secret patch text\"");
        const frame = await WaitForFrame(socket, "error");
        assert.equal(frame.code, "invalid_frame");
        assert.equal(captured.lines.length, 1);
        const log = ParseServerLog(captured.lines[0]!);
        assert.equal(log.service, "sheaf-chat");
        assert.equal(log.event, "sheaf_chat.handled_error");
        assert.equal(log.feature, "agent-review");
        assert.equal(log.code, "invalid_frame");
        assert.equal(log.repoId, repoId);
        assert.equal(log.workspaceId, workspaceId);
        assert.equal(log.clientId, "test-client");
        assert.match(String(log.message), /malformed|JSON|Unexpected/i);
        assert.equal(JSON.stringify(log).includes("secret patch text"), false);
      }
      finally
      {
        captured.restore();
        await CloseSocket(socket);
      }
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

async function CreateMultiHunkReviewSession(
  handle: TestServerHandle,
): Promise<{
  repoId: string;
  workspaceId: string;
  repoRoot: string;
  alphaPath: string;
  betaPath: string;
}>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);

  const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  const alphaPath = path.join(demoRoot, "alpha.ts");
  const betaPath = path.join(demoRoot, "beta.ts");
  await writeFile(alphaPath, `${base.join("\n")}\n`, "utf8");
  await writeFile(betaPath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  // alpha.ts: two changes far apart -> two separate hunks. beta.ts: one hunk.
  const alpha = base.slice();
  alpha[1] = "line 2 changed";
  alpha[26] = "line 27 changed";
  await writeFile(alphaPath, `${alpha.join("\n")}\n`, "utf8");
  const beta = base.slice();
  beta[14] = "line 15 changed";
  await writeFile(betaPath, `${beta.join("\n")}\n`, "utf8");

  return {
    repoId: created.repoId,
    workspaceId: created.workspaceId,
    repoRoot,
    alphaPath,
    betaPath,
  };
}

async function CreateThreeFileReviewSession(
  handle: TestServerHandle,
): Promise<{ repoId: string; workspaceId: string; betaPath: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const base = "line 1\nline 2\nline 3\n";
  const betaPath = path.join(demoRoot, "beta.ts");

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(path.join(demoRoot, "alpha.ts"), base, "utf8");
  await writeFile(betaPath, base, "utf8");
  await writeFile(path.join(demoRoot, "charlie.ts"), base, "utf8");
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  await writeFile(path.join(demoRoot, "alpha.ts"), "line 1\nalpha changed\nline 3\n", "utf8");
  await writeFile(betaPath, "line 1\nbeta changed\nline 3\n", "utf8");
  await writeFile(path.join(demoRoot, "charlie.ts"), "line 1\ncharlie changed\nline 3\n", "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId, betaPath };
}

async function CreateHeaderDriftReviewSession(
  handle: TestServerHandle,
): Promise<{ repoId: string; workspaceId: string; repoRoot: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const filePath = path.join(demoRoot, "app.ts");
  const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  const changed = base.slice();
  changed.splice(2, 0, "inserted before downstream hunk");
  changed[21] = "line 21 changed";
  await writeFile(filePath, `${changed.join("\n")}\n`, "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId, repoRoot };
}

async function CreateCloseHunkDriftReviewSession(
  handle: TestServerHandle,
): Promise<{ repoId: string; workspaceId: string; repoRoot: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const filePath = path.join(demoRoot, "app.ts");
  const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  const staged = base.slice();
  staged.splice(3, 0, "staged helper type");
  staged[8] = "line 9 staged";
  await writeFile(filePath, `${staged.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", "projects/demo/app.ts"]);

  const changed = staged.slice();
  changed.splice(2, 0, ...Array.from({ length: 20 }, (_, index) => `inserted setup ${index + 1}`));
  changed.splice(27, 0, "nearby inserted setup");
  changed[39] = "line 19 changed after inserted setup";
  await writeFile(filePath, `${changed.join("\n")}\n`, "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId, repoRoot };
}

async function CreateDuplicateContentReviewSession(
  handle: TestServerHandle,
): Promise<{ repoId: string; workspaceId: string; repoRoot: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const filePath = path.join(demoRoot, "app.ts");
  const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  base[1] = "repeat";
  base[26] = "repeat";

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  const changed = base.slice();
  changed[1] = "repeat changed";
  changed[26] = "repeat changed";
  await writeFile(filePath, `${changed.join("\n")}\n`, "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId, repoRoot };
}

async function CreateAmbiguousInsertionReviewSession(
  handle: TestServerHandle,
): Promise<{ repoId: string; workspaceId: string; repoRoot: string; fileRel: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const fileRel = "projects/demo/scope.hpp";
  const filePath = path.join(repoRoot, fileRel);

  const base = [
    "struct ResponseComponent",
    "{",
    "    bool m_logX;",
    "",
    "    ResponseComponent()",
    "        : m_voiceOffset(nullptr)",
    "        , m_logX(true)",
    "    {",
    "    }",
    "",
    "    void Draw()",
    "    {",
    "        responseDrawer.m_logX = m_logX;",
    "        responseDrawer.Draw();",
    "    }",
    "",
    "    void OnClick(const MouseEvent& event)",
    "    {",
    "        if (event.mods.isShiftDown())",
    "        {",
    "            m_logX = !m_logX;",
    "        }",
    "        else",
    "        {",
    "            ++(*m_voiceOffset);",
    "            if (*m_voiceOffset == static_cast<int>(x_voicesPerTrack))",
    "            {",
    "                *m_voiceOffset = -1;",
    "            }",
    "        }",
    "    }",
    "};",
    "",
    "struct LaterComponent",
    "{",
    "    void Paint();",
    "};",
  ];

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(filePath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", fileRel]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  const staged = base.filter((line) => line !== "    bool m_logX;");
  await writeFile(filePath, `${staged.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", fileRel]);

  const changed = [
    "struct ResponseComponent",
    "{",
    "",
    "    ResponseComponent()",
    "        : m_voiceOffset(nullptr)",
    "    {",
    "    }",
    "",
    "    void Draw()",
    "    {",
    "        responseDrawer.Draw();",
    "    }",
    "",
    "    void OnClick(const MouseEvent& event)",
    "    {",
    "        ++(*m_voiceOffset);",
    "        if (*m_voiceOffset == static_cast<int>(x_voicesPerTrack))",
    "        {",
    "            *m_voiceOffset = -1;",
    "        }",
    "    }",
    "};",
    "",
    "struct ThruFrequencyResponseComponent",
    "{",
    "    void Draw(Graphics& g)",
    "    {",
    "        int voiceOffset = *m_voiceOffset;",
    "        size_t baseVoiceIx = m_voiceIx->load() * x_voicesPerTrack;",
    "        size_t numLoops = voiceOffset == -1 ? x_voicesPerTrack : 1;",
    "",
    "        for (size_t loopIx = 0; loopIx < numLoops; ++loopIx)",
    "        {",
    "            size_t voiceIx = baseVoiceIx + (voiceOffset == -1 ? loopIx : static_cast<size_t>(voiceOffset));",
    "            if (voiceOffset == -1 && m_uiState->m_muted[voiceIx].load())",
    "            {",
    "                continue;",
    "            }",
    "",
    "            auto& sourceUIState = m_uiState->m_voiceSourceUIState[voiceIx];",
    "            if (sourceUIState.m_sourceMachine.load() != SourceMachine::Thru)",
    "            {",
    "                continue;",
    "            }",
    "",
    "            SmartGrid::Color color = TheNonagonSmartGrid::VoiceColor(voiceIx);",
    "            PathDrawer responseDrawer(height, width, 0, 0);",
    "            responseDrawer.DrawFrequencyResponse(",
    "                g,",
    "                Colour(color.m_red, color.m_green, color.m_blue),",
    "                sourceUIState.m_thruUIState,",
    "                1.0f);",
    "        }",
    "    }",
    "",
    "    void OnClick(const MouseEvent& event)",
    "    {",
    "        (void)event;",
    "        ++(*m_voiceOffset);",
    "        if (*m_voiceOffset == static_cast<int>(x_voicesPerTrack))",
    "        {",
    "            *m_voiceOffset = -1;",
    "        }",
    "    }",
    "};",
    "",
    "struct LaterComponent",
    "{",
    "    void Paint();",
    "};",
  ];
  await writeFile(filePath, `${changed.join("\n")}\n`, "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId, repoRoot, fileRel };
}

test("Agent Review WebSocket navigates between hunks and files", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const first = bootstrap.state.currentHunk;
    // Three hunks across two files: alpha.ts (x2), beta.ts (x1).
    assert.equal(first.file, "projects/demo/alpha.ts");
    assert.equal(first.hunkIndex, 0);
    assert.equal(first.hunkCount, 3);
    assert.equal(first.fileCount, 2);
    const alphaInline = bootstrap.state.inlineFiles.find(
      (file: Record<string, any>) => file.file === "projects/demo/alpha.ts",
    );
    assert.ok(alphaInline, "expected alpha.ts inline review document");
    const alphaHunkIds = new Set(
      alphaInline.rows
        .map((row: Record<string, any>) => row.hunkId)
        .filter(Boolean),
    );
    assert.equal(alphaHunkIds.size, 2);
    assert.ok(
      alphaInline.rows.some((row: Record<string, any>) =>
        row.kind === "addition" && row.text === "line 2 changed",
      ),
      "expected first alpha addition in inline rows",
    );
    assert.ok(
      alphaInline.rows.some((row: Record<string, any>) =>
        row.kind === "addition" && row.text === "line 27 changed",
      ),
      "expected second alpha addition in inline rows",
    );

    // Next hunk: advance to the second hunk in the same file.
    socket.send(JSON.stringify({ type: "command", id: "next-1", action: "nextHunk" }));
    const afterNextHunk = await WaitForFrame(socket, "command_result");
    assert.equal(afterNextHunk.result.ok, true);
    assert.equal(afterNextHunk.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(afterNextHunk.state.currentHunk.hunkIndex, 1);
    assert.notEqual(afterNextHunk.state.currentHunk.hunkId, first.hunkId);

    // Next file: advance to the first hunk of the next file.
    socket.send(JSON.stringify({ type: "command", id: "nextfile-1", action: "nextFile" }));
    const afterNextFile = await WaitForFrame(socket, "command_result");
    assert.equal(afterNextFile.result.ok, true);
    assert.equal(afterNextFile.state.currentHunk.file, "projects/demo/beta.ts");

    // Previous file: move back into the first file.
    socket.send(JSON.stringify({ type: "command", id: "prevfile-1", action: "previousFile" }));
    const afterPrevFile = await WaitForFrame(socket, "command_result");
    assert.equal(afterPrevFile.result.ok, true);
    assert.equal(afterPrevFile.state.currentHunk.file, "projects/demo/alpha.ts");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review file navigation can start from a focused file without hunks", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    await WaitForFrame(socket, "bootstrap");

    socket.send(JSON.stringify({
      type: "focus",
      hunkId: null,
      file: "projects/demo/aaa.ts",
    }));
    const anchored = await WaitForFrame(socket, "state");
    assert.equal(anchored.state.currentHunk, null);
    assert.equal(anchored.state.actions.canGoPrevFile, false);
    assert.equal(anchored.state.actions.canGoNextFile, true);
    assert.equal(anchored.state.actions.canStage, false);
    assert.equal(anchored.state.actions.canRevert, false);

    socket.send(JSON.stringify({ type: "command", id: "next-from-anchor", action: "nextFile" }));
    const afterNext = await WaitForFrame(socket, "command_result");
    assert.equal(afterNext.result.ok, true);
    assert.equal(afterNext.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(afterNext.state.currentHunk.hunkIndex, 0);

    socket.send(JSON.stringify({
      type: "focus",
      hunkId: null,
      file: "projects/demo/zzz.ts",
    }));
    const anchoredAfter = await WaitForFrame(socket, "state");
    assert.equal(anchoredAfter.state.currentHunk, null);
    assert.equal(anchoredAfter.state.actions.canGoPrevFile, true);
    assert.equal(anchoredAfter.state.actions.canGoNextFile, false);

    socket.send(JSON.stringify({ type: "command", id: "prev-from-anchor", action: "previousFile" }));
    const afterPrev = await WaitForFrame(socket, "command_result");
    assert.equal(afterPrev.result.ok, true);
    assert.equal(afterPrev.state.currentHunk.file, "projects/demo/beta.ts");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review excludes binary diffs from hunks and inline documents", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const repoRoot = handle.agentManager.storagePaths.repoRoot;
    const demoRoot = path.join(repoRoot, "projects/demo");
    const { repoId, workspaceId } = await CreateWorkspaceChatViaApi(handle, demoRoot);
    const binaryPath = path.join(demoRoot, "image.bin");

    await mkdir(demoRoot, { recursive: true });
    await Git(repoRoot, ["init"]);
    await Git(repoRoot, ["config", "user.email", "test@example.com"]);
    await Git(repoRoot, ["config", "user.name", "Test User"]);
    await writeFile(binaryPath, Buffer.from([0, 1, 2, 3, 4, 5]));
    await Git(repoRoot, ["add", "projects/demo/image.bin"]);
    await Git(repoRoot, ["commit", "-m", "initial"]);
    await writeFile(binaryPath, Buffer.from([0, 1, 2, 3, 255, 5]));

    const response = await RequestJson(
      handle.baseUrl,
      "GET",
      `/api/repositories/${encodeURIComponent(repoId)}/workspaces/${encodeURIComponent(workspaceId)}/agent-review`,
    );
    assert.equal(response.status, 200);
    const body = response.body as {
      available: boolean;
      hunks: unknown[];
      inlineFiles: unknown[];
    };
    assert.equal(body.available, true);
    assert.deepEqual(body.hunks, []);
    assert.deepEqual(body.inlineFiles, []);
  });
});

test("Agent Review Dictator RPC cell reveals comments and inserts serialized review", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));

      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });

      const bootstrap = await WaitForFrame(socket, "bootstrap");
      const hunk = bootstrap.state.currentHunk;
      assert.equal(hunk.file, "projects/demo/app.ts");

      const setCells = await fakeDictator.waitForRequest("launchpad.setCells");
      const reviewCell = setCells.params.cells.find(
        (cell: Record<string, unknown>) => cell.x === 3 && cell.y === 3,
      );
      assert.deepEqual(reviewCell, { x: 3, y: 3, r: 90, g: 90, b: 90 });

      fakeDictator.sendPress();
      const focusComment = await WaitForFrame(socket, "focus_comment");
      assert.equal(focusComment.hunkId, hunk.hunkId);

      socket.send(JSON.stringify({ type: "comment_focus", hunkId: hunk.hunkId }));
      const pushContext = await fakeDictator.waitForRequest("dictationContext.push");
      assert.equal(pushContext.params.id, `comment:${hunk.hunkId}`);
      assert.match(pushContext.params.body, /two changed/);

      socket.send(JSON.stringify({ type: "comment_blur", hunkId: hunk.hunkId }));
      const popContext = await fakeDictator.waitForRequest("dictationContext.pop");
      assert.equal(popContext.params.id, `comment:${hunk.hunkId}`);

      const commentedPromise = WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.reviewDraft.entries.length === 1,
        "commented draft state",
      );
      socket.send(JSON.stringify({
        type: "comment",
        hunkId: hunk.hunkId,
        text: "Please simplify this branch.",
      }));
      const commented = await commentedPromise;
      assert.equal(commented.state.reviewDraft.entries[0].kind, "comment");
      assert.equal(commented.state.reviewDraft.entries[0].text, "Please simplify this branch.");

      const awayPromise = WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.currentHunk === null,
        "away review state",
      );
      socket.send(JSON.stringify({ type: "focus", hunkId: null }));
      const away = await awayPromise;
      assert.equal(away.state.currentHunk, null);
      assert.equal(away.state.reviewDraft.hasSerializedContent, true);

      const insertPromise = fakeDictator.waitForRequest("cursor.insertText");
      const clearedPromise = WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.reviewDraft.entries.length === 0,
        "cleared review state",
      );
      fakeDictator.sendPress();
      await insertPromise;
      assert.match(fakeDictator.insertedText ?? "", /Please simplify this branch\./);
      assert.match(fakeDictator.insertedText ?? "", /```diff/);
      const cleared = await clearedPromise;
      assert.equal(cleared.state.reviewDraft.entries.length, 0);

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

function CellMap(cells: Array<Record<string, unknown>>): Map<string, Record<string, unknown>>
{
  const map = new Map<string, Record<string, unknown>>();
  for (const cell of cells)
  {
    map.set(`${cell.x},${cell.y}`, cell);
  }
  return map;
}

function NonReviewCellsOff(cells: Array<Record<string, unknown>>): boolean
{
  return cells.length > 0 && cells.every((cell) =>
    (cell.x === 3 && cell.y === 3) || cell.off === true,
  );
}

test("Agent Review Launchpad navigation cells reflect action availability", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");

      const setCells = await fakeDictator.waitForRequest("launchpad.setCells");
      const cells = CellMap(setCells.params.cells);

      // First hunk of alpha.ts (two hunks), with beta.ts after it. Hunk
      // navigation loops within the file, so both next-hunk and previous-hunk are
      // available. next-file is available because another file exists after the
      // current one; previous-file is not (alpha.ts is the first file). Stage and
      // revert are available; undo is not.
      assert.deepEqual(cells.get("0,2"), { x: 0, y: 2, r: 255, g: 0, b: 0 }); // revert
      assert.deepEqual(cells.get("2,2"), { x: 2, y: 2, r: 0, g: 255, b: 0 }); // stage
      assert.deepEqual(cells.get("1,3"), { x: 1, y: 3, r: 255, g: 255, b: 0 }); // next hunk
      assert.deepEqual(cells.get("1,2"), { x: 1, y: 2, r: 255, g: 255, b: 0 }); // previous hunk (loops)
      assert.deepEqual(cells.get("3,2"), { x: 3, y: 2, off: true }); // undo
      assert.deepEqual(cells.get("0,3"), { x: 0, y: 3, off: true }); // previous file (first file)
      assert.deepEqual(cells.get("2,3"), { x: 2, y: 3, r: 255, g: 255, b: 0 }); // next file (beta exists)
      assert.deepEqual(cells.get("3,3"), { x: 3, y: 3, r: 90, g: 90, b: 90 }); // review cell grey

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review unfocused Dictator RPC cell is off and no-op without armed draft", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");

      const awayPromise = WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.currentHunk === null,
        "unfocused no-draft state",
      );
      socket.send(JSON.stringify({ type: "focus", hunkId: null }));
      await awayPromise;

      fakeDictator.clearRequests();
      socket.send(JSON.stringify({ type: "presence", focused: false }));
      const dark = await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        (req) => AllCellsOff(req.params.cells),
      );
      assert.deepEqual(CellMap(dark.params.cells).get("3,3"), { x: 3, y: 3, off: true });

      fakeDictator.clearRequests();
      fakeDictator.sendPress(3, 3);
      await assert.rejects(
        fakeDictator.waitForRequest("cursor.insertText", 100),
        /timed out waiting for Dictator RPC request: cursor\.insertText/,
      );

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review unfocused armed review cell stays green and pastes via Dictator RPC cell", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });

      const bootstrap = await WaitForFrame(socket, "bootstrap");
      const hunk = bootstrap.state.currentHunk;
      await fakeDictator.waitForRequest("launchpad.setCells");

      const commentedPromise = WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.reviewDraft.entries.length === 1,
        "unfocused armed review draft",
      );
      socket.send(JSON.stringify({
        type: "comment",
        hunkId: hunk.hunkId,
        text: "Keep this explanation for the next turn.",
      }));
      await commentedPromise;

      const awayPromise = WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.currentHunk === null && frame.state.reviewDraft.hasSerializedContent,
        "unfocused armed no-hunk state",
      );
      socket.send(JSON.stringify({ type: "focus", hunkId: null }));
      await awayPromise;

      fakeDictator.clearRequests();
      socket.send(JSON.stringify({ type: "presence", focused: false }));
      const armed = await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        (req) =>
          NonReviewCellsOff(req.params.cells) &&
          CellMap(req.params.cells).get("3,3")?.g === 255,
      );
      const armedCells = CellMap(armed.params.cells);
      assert.deepEqual(armedCells.get("1,3"), { x: 1, y: 3, off: true });
      assert.deepEqual(armedCells.get("0,2"), { x: 0, y: 2, off: true });
      assert.deepEqual(armedCells.get("3,3"), { x: 3, y: 3, r: 0, g: 255, b: 0 });

      fakeDictator.clearRequests();
      fakeDictator.failNextRequest("cursor.insertText", { message: "paste failed" });
      const failedInsert = fakeDictator.waitForRequest("cursor.insertText");
      const stillArmed = fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        (req) => CellMap(req.params.cells).get("3,3")?.g === 255,
      );
      fakeDictator.sendPress(3, 3);
      await failedInsert;
      await stillArmed;

      fakeDictator.clearRequests();
      const insertPromise = fakeDictator.waitForRequest("cursor.insertText");
      const clearedPromise = WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.reviewDraft.entries.length === 0,
        "unfocused pasted review draft",
      );
      fakeDictator.sendPress(3, 3);
      await insertPromise;
      assert.match(fakeDictator.insertedText ?? "", /Keep this explanation for the next turn\./);
      const cleared = await clearedPromise;
      assert.equal(cleared.state.reviewDraft.hasSerializedContent, false);

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad next-hunk cell advances the current hunk", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      const bootstrap = await WaitForFrame(socket, "bootstrap");
      assert.equal(bootstrap.state.currentHunk.hunkIndex, 0);
      await fakeDictator.waitForRequest("launchpad.setCells");

      const advanced = WaitForFrameWhere(
        socket,
        "command_result",
        (frame) =>
          frame.result?.ok === true &&
          frame.result?.action === "nextHunk" &&
          typeof frame.result?.commandId === "string" &&
          frame.result.commandId.startsWith("launchpad:") &&
          frame.state.currentHunk?.hunkIndex === 1,
        "next hunk via launchpad",
      );
      fakeDictator.sendPress(1, 3); // next-hunk cell
      const state = await advanced;
      assert.equal(state.state.currentHunk.hunkIndex, 1);

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad next-file cell emits command result and advances file", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      const bootstrap = await WaitForFrame(socket, "bootstrap");
      assert.equal(bootstrap.state.currentHunk.file, "projects/demo/alpha.ts");
      await fakeDictator.waitForRequest("launchpad.setCells");

      const commandResult = WaitForFrameWhere(
        socket,
        "command_result",
        (frame) =>
          frame.result?.ok === true &&
          frame.result?.action === "nextFile" &&
          typeof frame.result?.commandId === "string" &&
          frame.result.commandId.startsWith("launchpad:") &&
          frame.state.currentHunk?.file === "projects/demo/beta.ts",
        "next file via launchpad command result",
      );
      fakeDictator.sendPress(2, 3);
      const frame = await commandResult;
      assert.equal(frame.state.currentHunk.file, "projects/demo/beta.ts");

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad file navigation can start from a focused file without hunks", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");

      socket.send(JSON.stringify({
        type: "focus",
        hunkId: null,
        file: "projects/demo/aaa.ts",
      }));
      const anchored = await WaitForFrame(socket, "state");
      assert.equal(anchored.state.currentHunk, null);
      assert.equal(anchored.state.actions.canGoNextFile, true);
      await fakeDictator.waitForRequest("launchpad.setCells");

      const commandResult = WaitForFrameWhere(
        socket,
        "command_result",
        (frame) =>
          frame.result?.ok === true &&
          frame.result?.action === "nextFile" &&
          typeof frame.result?.commandId === "string" &&
          frame.result.commandId.startsWith("launchpad:") &&
          frame.state.currentHunk?.file === "projects/demo/alpha.ts",
        "next file from non-hunk selected file via launchpad",
      );
      fakeDictator.sendPress(2, 3);
      const frame = await commandResult;
      assert.equal(frame.state.currentHunk.file, "projects/demo/alpha.ts");

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad ignores presses for unavailable actions", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");

      // Record the index of every state frame until the next-hunk command lands.
      const seen: number[] = [];
      const reachedNextHunk = new Promise<void>((resolve) =>
      {
        const onMessage = (raw: WebSocket.RawData): void =>
        {
          const frame = JSON.parse(raw.toString()) as Record<string, any>;
          if (frame.type === "state" && frame.state.currentHunk != null)
          {
            seen.push(frame.state.currentHunk.hunkIndex);
            if (frame.state.currentHunk.hunkIndex === 1)
            {
              socket.off("message", onMessage);
              resolve();
            }
          }
        };
        socket.on("message", onMessage);
      });

      // Undo is unavailable at the first hunk (no prior mutation); its press must
      // be a no-op that emits no frame. The available next-hunk press follows.
      fakeDictator.sendPress(3, 2); // undo cell (off / unavailable)
      fakeDictator.sendPress(1, 3); // next-hunk cell (available)
      await reachedNextHunk;

      // If the unavailable undo press had been dispatched it would have broadcast
      // an index-0 state frame first; the guard means the only frame is next-hunk.
      assert.deepEqual(seen, [1]);

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad mutation cells emit command results", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");

      const staged = WaitForFrameWhere(
        socket,
        "command_result",
        (frame) =>
          frame.result?.ok === true &&
          frame.result?.action === "stage" &&
          typeof frame.result?.commandId === "string" &&
          frame.result.commandId.startsWith("launchpad:") &&
          frame.state.actions.canUndo === true,
        "stage via launchpad",
      );
      fakeDictator.sendPress(2, 2);
      const afterStage = await staged;
      assert.equal(afterStage.result.action, "stage");

      const undone = WaitForFrameWhere(
        socket,
        "command_result",
        (frame) =>
          frame.result?.ok === true &&
          frame.result?.action === "undo" &&
          typeof frame.result?.commandId === "string" &&
          frame.result.commandId.startsWith("launchpad:"),
        "undo via launchpad",
      );
      fakeDictator.sendPress(3, 2);
      const afterUndo = await undone;
      assert.equal(afterUndo.result.action, "undo");

      const reverted = WaitForFrameWhere(
        socket,
        "command_result",
        (frame) =>
          frame.result?.ok === true &&
          frame.result?.action === "revert" &&
          typeof frame.result?.commandId === "string" &&
          frame.result.commandId.startsWith("launchpad:") &&
          frame.state.reviewDraft.hasSerializedContent === true,
        "revert via launchpad",
      );
      fakeDictator.sendPress(0, 2);
      const afterRevert = await reverted;
      assert.equal(afterRevert.result.action, "revert");

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad mutation failures are logged as handled server errors", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId, filePath } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      const bootstrap = await WaitForFrame(socket, "bootstrap");
      const hunk = bootstrap.state.currentHunk;
      await fakeDictator.waitForRequest("launchpad.setCells");

      // Leave Sheaf Chat's cached hunk state stale while making the patch no
      // longer apply. The lit Launchpad stage cell will dispatch the command,
      // which must fail visibly in server logs.
      await writeFile(filePath, "one\ntwo externally changed\nthree\n", "utf8");

      const captured = CaptureConsoleError();
      try
      {
        const failed = WaitForFrameWhere(
          socket,
          "command_result",
          (frame) =>
            frame.result?.ok === false &&
            frame.result?.action === "stage" &&
            typeof frame.result?.commandId === "string" &&
            frame.result.commandId.startsWith("launchpad:"),
          "failed stage via launchpad",
        );
        fakeDictator.sendPress(2, 2);
        const frame = await failed;
        assert.equal(frame.result.stale, true);
        assert.match(String(frame.result.error), /focused hunk changed|patch changed/);

        assert.equal(captured.lines.length, 1);
        const log = ParseServerLog(captured.lines[0]!);
        assert.equal(log.service, "sheaf-chat");
        assert.equal(log.event, "sheaf_chat.handled_error");
        assert.equal(log.feature, "agent-review");
        assert.equal(log.action, "stage");
        assert.equal(log.repoId, repoId);
        assert.equal(log.workspaceId, workspaceId);
        assert.equal(typeof log.commandId, "string");
        assert.equal(String(log.commandId).startsWith("launchpad:"), true);
        assert.equal(log.stale, true);
        assert.equal(JSON.stringify(log).includes(hunk.patch), false);
      }
      finally
      {
        captured.restore();
      }

      await CloseSocket(socket);
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

function AllCellsOff(cells: Array<Record<string, unknown>>): boolean
{
  return cells.length > 0 && cells.every((cell) => cell.off === true);
}

test("Agent Review next/previous hunk loop within the current file", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    assert.equal(bootstrap.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(bootstrap.state.currentHunk.hunkIndex, 0);
    // alpha.ts has two hunks, so in-file looping makes both directions available.
    assert.equal(bootstrap.state.actions.canGoUp, true);
    assert.equal(bootstrap.state.actions.canGoDown, true);

    const Command = async (action: string): Promise<Record<string, any>> =>
    {
      socket.send(JSON.stringify({ type: "command", action }));
      return WaitForFrame(socket, "command_result");
    };

    // Next within alpha: hunk 0 -> hunk 1.
    let res = await Command("nextHunk");
    assert.equal(res.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(res.state.currentHunk.hunkIndex, 1);

    // Next from alpha's last hunk wraps back to alpha's first hunk.
    res = await Command("nextHunk");
    assert.equal(res.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(res.state.currentHunk.hunkIndex, 0);

    // Previous from alpha's first hunk wraps to alpha's last hunk.
    res = await Command("previousHunk");
    assert.equal(res.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(res.state.currentHunk.hunkIndex, 1);

    // Crossing files uses the file command.
    res = await Command("nextFile");
    assert.equal(res.state.currentHunk.file, "projects/demo/beta.ts");
    assert.equal(res.state.currentHunk.hunkIndex, 2);
    // beta.ts has a single hunk: hunk navigation is unavailable and a no-op.
    assert.equal(res.state.actions.canGoUp, false);
    assert.equal(res.state.actions.canGoDown, false);

    res = await Command("nextHunk");
    assert.equal(res.state.currentHunk.file, "projects/demo/beta.ts");
    assert.equal(res.state.currentHunk.hunkIndex, 2);

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review file navigation works from any hunk and lands on a file's first hunk", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    // alpha.ts hunk 0: the adjacent hunk is still alpha, but beta.ts exists, so
    // next-file is available regardless of the selected hunk. previous-file is
    // not (alpha.ts is the first file).
    assert.equal(bootstrap.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(bootstrap.state.currentHunk.hunkIndex, 0);
    assert.equal(bootstrap.state.actions.canGoNextFile, true);
    assert.equal(bootstrap.state.actions.canGoPrevFile, false);

    const Command = async (action: string): Promise<Record<string, any>> =>
    {
      socket.send(JSON.stringify({ type: "command", action }));
      return WaitForFrame(socket, "command_result");
    };

    // Next file lands on beta.ts's first (only) hunk.
    let res = await Command("nextFile");
    assert.equal(res.state.currentHunk.file, "projects/demo/beta.ts");
    assert.equal(res.state.currentHunk.hunkIndex, 2);
    assert.equal(res.state.actions.canGoNextFile, false);
    assert.equal(res.state.actions.canGoPrevFile, true);

    // Previous file lands on alpha.ts's FIRST hunk, not its last.
    res = await Command("previousFile");
    assert.equal(res.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(res.state.currentHunk.hunkIndex, 0);

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review staging a hunk prefers remaining hunks in the same file", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    await WaitForFrame(socket, "bootstrap");

    socket.send(JSON.stringify({ type: "command", action: "nextHunk" }));
    const secondAlpha = await WaitForFrame(socket, "command_result");
    assert.equal(secondAlpha.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(secondAlpha.state.currentHunk.hunkIndex, 1);

    socket.send(JSON.stringify({ type: "command", action: "stage" }));
    const staged = await WaitForFrame(socket, "command_result");
    assert.equal(staged.result.ok, true);
    assert.equal(staged.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.equal(staged.state.currentHunk.hunkIndex, 0);

    const alphaInline = staged.state.inlineFiles.find(
      (file: Record<string, any>) => file.file === "projects/demo/alpha.ts",
    );
    assert.ok(alphaInline, "expected alpha.ts inline review document after staging");
    assert.ok(
      alphaInline.rows.some((row: Record<string, any>) =>
        row.kind === "context" && row.text === "line 27 changed",
      ),
      "expected staged alpha hunk to remain visible as normal context",
    );

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review stages and reverts a non-first hunk without mutating siblings", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot, alphaPath } =
      await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    await WaitForFrame(socket, "bootstrap");
    socket.send(JSON.stringify({ type: "command", id: "next-alpha", action: "nextHunk" }));
    const next = await WaitForFrame(socket, "command_result");
    const secondAlpha = next.state.currentHunk;
    assert.equal(secondAlpha.file, "projects/demo/alpha.ts");
    assert.match(secondAlpha.patch, /line 27 changed/);
    assert.doesNotMatch(secondAlpha.patch, /line 2 changed/);

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-second-alpha",
      action: "stage",
      hunkId: secondAlpha.hunkId,
      patchHash: secondAlpha.patchHash,
    }));
    const staged = await WaitForFrame(socket, "command_result");
    assert.equal(staged.result.ok, true);
    const cached = await Git(repoRoot, [
      "diff",
      "--cached",
      "--unified=0",
      "--",
      "projects/demo/alpha.ts",
    ]);
    const unstaged = await Git(repoRoot, [
      "diff",
      "--unified=0",
      "--",
      "projects/demo/alpha.ts",
    ]);
    assert.match(cached, /line 27 changed/);
    assert.doesNotMatch(cached, /line 2 changed/);
    assert.match(unstaged, /line 2 changed/);
    assert.doesNotMatch(unstaged, /line 27 changed/);

    socket.send(JSON.stringify({ type: "command", id: "undo-stage-alpha", action: "undo" }));
    const undoStage = await WaitForFrame(socket, "command_result");
    assert.equal(undoStage.result.ok, true);
    assert.equal((await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/alpha.ts"])).trim(), "");
    assert.equal(undoStage.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.match(undoStage.state.currentHunk.patch, /line 27 changed/);
    assert.doesNotMatch(undoStage.state.currentHunk.patch, /line 2 changed/);

    socket.send(JSON.stringify({
      type: "command",
      id: "revert-second-alpha",
      action: "revert",
      hunkId: undoStage.state.currentHunk.hunkId,
      patchHash: undoStage.state.currentHunk.patchHash,
    }));
    const reverted = await WaitForFrame(socket, "command_result");
    assert.equal(reverted.result.ok, true);
    assert.equal(reverted.state.reviewDraft.entries.at(-1).kind, "rejected");
    assert.equal(reverted.state.reviewDraft.entries.at(-1).hunk.file, "projects/demo/alpha.ts");
    assert.match(reverted.state.reviewDraft.entries.at(-1).hunk.patch, /line 27 changed/);
    assert.equal(
      await readFile(alphaPath, "utf8"),
      `${[
        "line 1", "line 2 changed", "line 3", "line 4", "line 5",
        "line 6", "line 7", "line 8", "line 9", "line 10",
        "line 11", "line 12", "line 13", "line 14", "line 15",
        "line 16", "line 17", "line 18", "line 19", "line 20",
        "line 21", "line 22", "line 23", "line 24", "line 25",
        "line 26", "line 27", "line 28", "line 29", "line 30",
      ].join("\n")}\n`,
    );

    socket.send(JSON.stringify({ type: "command", id: "undo-revert-alpha", action: "undo" }));
    const undoRevert = await WaitForFrame(socket, "command_result");
    assert.equal(undoRevert.result.ok, true);
    assert.equal(undoRevert.state.reviewDraft.entries.length, 0);
    assert.equal(
      await readFile(alphaPath, "utf8"),
      `${[
        "line 1", "line 2 changed", "line 3", "line 4", "line 5",
        "line 6", "line 7", "line 8", "line 9", "line 10",
        "line 11", "line 12", "line 13", "line 14", "line 15",
        "line 16", "line 17", "line 18", "line 19", "line 20",
        "line 21", "line 22", "line 23", "line 24", "line 25",
        "line 26", "line 27 changed", "line 28", "line 29", "line 30",
      ].join("\n")}\n`,
    );
    assert.equal(undoRevert.state.currentHunk.file, "projects/demo/alpha.ts");
    assert.match(undoRevert.state.currentHunk.patch, /line 27 changed/);

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review does not auto-advance to another file after completing a file", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    await WaitForFrame(socket, "bootstrap");
    socket.send(JSON.stringify({ type: "command", id: "stage-first-alpha", action: "stage" }));
    const afterFirst = await WaitForFrame(socket, "command_result");
    assert.equal(afterFirst.result.ok, true);
    assert.equal(afterFirst.state.currentHunk.file, "projects/demo/alpha.ts");

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-last-alpha",
      action: "stage",
      hunkId: afterFirst.state.currentHunk.hunkId,
      patchHash: afterFirst.state.currentHunk.patchHash,
    }));
    const afterLast = await WaitForFrame(socket, "command_result");
    assert.equal(afterLast.result.ok, true);
    assert.equal(afterLast.state.currentHunk, null);
    assert.equal(afterLast.state.actions.canGoNextFile, true);
    assert.equal(afterLast.state.actions.canStage, false);

    socket.send(JSON.stringify({ type: "command", id: "explicit-next-file", action: "nextFile" }));
    const explicitNext = await WaitForFrame(socket, "command_result");
    assert.equal(explicitNext.result.ok, true);
    assert.equal(explicitNext.state.currentHunk.file, "projects/demo/beta.ts");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review nextFile from a completed middle file advances to the following file", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateThreeFileReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    assert.equal(bootstrap.state.currentHunk.file, "projects/demo/alpha.ts");

    socket.send(JSON.stringify({ type: "command", id: "middle-file", action: "nextFile" }));
    const middle = await WaitForFrame(socket, "command_result");
    assert.equal(middle.result.ok, true);
    assert.equal(middle.state.currentHunk.file, "projects/demo/beta.ts");

    socket.send(JSON.stringify({
      type: "command",
      id: "complete-middle-file",
      action: "stage",
      hunkId: middle.state.currentHunk.hunkId,
      patchHash: middle.state.currentHunk.patchHash,
    }));
    const completedMiddle = await WaitForFrame(socket, "command_result");
    assert.equal(completedMiddle.result.ok, true);
    assert.equal(completedMiddle.state.currentHunk, null);
    assert.equal(completedMiddle.state.actions.canGoNextFile, true);

    socket.send(JSON.stringify({ type: "command", id: "next-after-middle", action: "nextFile" }));
    const afterNext = await WaitForFrame(socket, "command_result");
    assert.equal(afterNext.result.ok, true);
    assert.equal(afterNext.state.currentHunk.file, "projects/demo/charlie.ts");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review preserves sibling hunks when downstream headers drift", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot } = await CreateHeaderDriftReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const insertion = bootstrap.state.currentHunk;
    assert.equal(insertion.file, "projects/demo/app.ts");
    assert.match(insertion.patch, /inserted before downstream hunk/);
    assert.doesNotMatch(insertion.patch, /line 21 changed/);

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-insertion",
      action: "stage",
      hunkId: insertion.hunkId,
      patchHash: insertion.patchHash,
    }));
    const staged = await WaitForFrame(socket, "command_result");
    assert.equal(staged.result.ok, true);
    assert.equal(staged.state.currentHunk.file, "projects/demo/app.ts");
    assert.match(staged.state.currentHunk.patch, /line 21 changed/);

    const unstaged = await Git(repoRoot, [
      "diff",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    assert.match(unstaged, /line 21 changed/);
    assert.doesNotMatch(unstaged, /inserted before downstream hunk/);

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review can stage the first close hunk again after undoing sibling stages", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot } = await CreateCloseHunkDriftReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    assert.equal(bootstrap.state.hunks.length, 3);

    socket.send(JSON.stringify({ type: "command", id: "next-1", action: "nextHunk" }));
    await WaitForFrame(socket, "command_result");
    socket.send(JSON.stringify({ type: "command", id: "next-2", action: "nextHunk" }));
    const last = await WaitForFrame(socket, "command_result");
    assert.match(last.state.currentHunk.patch, /line 19 changed after inserted setup/);

    let current = last.state.currentHunk;
    for (const id of ["stage-last", "stage-first", "stage-middle"])
    {
      socket.send(JSON.stringify({
        type: "command",
        id,
        action: "stage",
        hunkId: current.hunkId,
        patchHash: current.patchHash,
      }));
      const staged = await WaitForFrame(socket, "command_result");
      assert.equal(staged.result.ok, true);
      current = staged.state.currentHunk;
    }

    for (const id of ["undo-first", "undo-middle", "undo-last"])
    {
      socket.send(JSON.stringify({ type: "command", id, action: "undo" }));
      const undone = await WaitForFrame(socket, "command_result");
      assert.equal(undone.result.ok, true);
    }

    socket.send(JSON.stringify({ type: "command", id: "wrap-to-first", action: "nextHunk" }));
    const wrapped = await WaitForFrame(socket, "command_result");
    const first = wrapped.state.currentHunk;
    assert.match(first.patch, /inserted setup 1/);

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-first-again",
      action: "stage",
      hunkId: first.hunkId,
      patchHash: first.patchHash,
    }));
    const restaged = await WaitForFrame(socket, "command_result");
    assert.equal(restaged.result.ok, true);

    const cached = await Git(repoRoot, [
      "diff",
      "--cached",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    const unstaged = await Git(repoRoot, [
      "diff",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    assert.match(cached, /inserted setup 1/);
    assert.doesNotMatch(cached, /nearby inserted setup/);
    assert.match(unstaged, /nearby inserted setup/);

    await CloseSocket(socket);
  });
});

test("Agent Review randomized mixed-index staging preserves sibling hunks", async () =>
{
  await WithTestServer(async (handle) =>
  {
    for (const seed of [3, 11, 29, 47])
    {
      const { repoId, workspaceId, repoRoot, fileRel } =
        await CreateSeededMixedIndexReviewSession(handle, seed);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });

      const bootstrap = await WaitForFrame(socket, "bootstrap");
      const initialHunkCount = bootstrap.state.hunks.length;
      assert.ok(
        initialHunkCount >= 3,
        `seed ${seed} should expose multiple unstaged hunks`,
      );

      let current = bootstrap.state.currentHunk;
      assert.ok(current, `seed ${seed} should focus a hunk`);
      socket.send(JSON.stringify({
        type: "command",
        id: `seed-${seed}-stage-first`,
        action: "stage",
        hunkId: current.hunkId,
        patchHash: current.patchHash,
      }));
      const stagedFirst = await WaitForFrame(socket, "command_result");
      assert.equal(stagedFirst.result.ok, true, `seed ${seed} initial stage`);

      socket.send(JSON.stringify({ type: "command", id: `seed-${seed}-undo`, action: "undo" }));
      const undone = await WaitForFrame(socket, "command_result");
      assert.equal(undone.result.ok, true, `seed ${seed} undo`);
      current = undone.state.currentHunk;

      for (let attempt = 0; attempt < Math.min(2, initialHunkCount - 1) && current !== null; attempt += 1)
      {
        socket.send(JSON.stringify({
          type: "command",
          id: `seed-${seed}-restage-${attempt}`,
          action: "stage",
          hunkId: current.hunkId,
          patchHash: current.patchHash,
        }));
        const restaged = await WaitForFrame(socket, "command_result");
        assert.equal(restaged.result.ok, true, `seed ${seed} restage ${attempt}`);
        current = restaged.state.currentHunk;
      }

      const cached = await Git(repoRoot, ["diff", "--cached", "--unified=0", "--", fileRel]);
      const unstaged = await Git(repoRoot, ["diff", "--unified=0", "--", fileRel]);
      assert.match(cached, /duplicate changed text|unstaged inserted sibling|tail changed/);
      assert.notEqual(unstaged.trim(), "", `seed ${seed} should leave sibling hunks unstaged`);

      await CloseSocket(socket);
      await Git(repoRoot, ["reset", "--hard", "HEAD"]);
    }
  });
});

test("Agent Review randomized state machine validates hunk mutations semantically", async () =>
{
  await WithTestServer(async (handle) =>
  {
    for (const seed of StateMachineSeeds())
    {
      const fixture = await CreateStateMachineReviewSession(handle, seed);
      const socket = await ConnectAgentReviewSocket(handle.baseUrl, fixture.repoId, fixture.workspaceId);
      const staleTargets: Record<string, any>[] = [];
      const next = SeededInt(seed ^ 0x9e3779b9);
      let state: Record<string, any>;
      try
      {
        const bootstrap = await WaitForFrame(socket, "bootstrap");
        state = bootstrap.state;
        await AssertStateMachineOracle(fixture, state, {
          seed,
          step: 0,
          operation: "bootstrap",
        });

        for (let step = 1; step <= StateMachineStepCount(); step += 1)
        {
          const operation = ChooseStateMachineOperation(fixture, state, staleTargets, next);
          const context: StateMachineContext = {
            seed,
            step,
            operation: operation.kind,
          };
          state = await ExecuteStateMachineOperation(
            socket,
            fixture,
            state,
            operation,
            context,
            staleTargets,
          );
          await AssertStateMachineOracle(fixture, state, context);

          if (ActiveStateMachineEdits(fixture).length === 0 && fixture.undoStack.length === 0)
          {
            break;
          }
        }
      }
      finally
      {
        await CloseSocket(socket);
      }
    }
  });
});

test("Agent Review stages a non-first duplicate-content hunk without rejecting its sibling", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot } = await CreateDuplicateContentReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    assert.equal(bootstrap.state.currentHunk.file, "projects/demo/app.ts");
    assert.match(bootstrap.state.currentHunk.patch, /@@ -2 \+2 @@/);

    socket.send(JSON.stringify({ type: "command", id: "second-duplicate", action: "nextHunk" }));
    const second = await WaitForFrame(socket, "command_result");
    assert.equal(second.state.currentHunk.file, "projects/demo/app.ts");
    assert.match(second.state.currentHunk.patch, /@@ -27 \+27 @@/);
    assert.match(second.state.currentHunk.patch, /repeat changed/);

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-second-duplicate",
      action: "stage",
      hunkId: second.state.currentHunk.hunkId,
      patchHash: second.state.currentHunk.patchHash,
    }));
    const staged = await WaitForFrame(socket, "command_result");
    assert.equal(staged.result.ok, true);
    assert.equal(staged.state.currentHunk.file, "projects/demo/app.ts");
    assert.match(staged.state.currentHunk.patch, /@@ -2 \+2 @@/);

    const cached = await Git(repoRoot, [
      "diff",
      "--cached",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    const unstaged = await Git(repoRoot, [
      "diff",
      "--unified=0",
      "--",
      "projects/demo/app.ts",
    ]);
    assert.match(cached, /@@ -27 \+27 @@/);
    assert.doesNotMatch(cached, /@@ -2 \+2 @@/);
    assert.match(unstaged, /@@ -2 \+2 @@/);
    assert.doesNotMatch(unstaged, /@@ -27 \+27 @@/);

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review stages an insertion-only hunk from a larger inserted block at its real location", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot, fileRel } = await CreateAmbiguousInsertionReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    const bootstrap = await WaitForFrame(socket, "bootstrap");
    const target = bootstrap.state.hunks.find((hunk: Record<string, any>) =>
      hunk.file === fileRel &&
      hunk.patch.includes("SmartGrid::Color color = TheNonagonSmartGrid::VoiceColor(voiceIx)")
    );
    assert.ok(target, "expected an insertion-only frequency-response drawing hunk");
    assert.match(target.patch, /^@@ -\d+,0 \+\d+,\d+ @@/m);

    let current = bootstrap.state.currentHunk;
    for (let attempt = 0; current.hunkId !== target.hunkId && attempt < bootstrap.state.hunks.length; attempt += 1)
    {
      socket.send(JSON.stringify({
        type: "command",
        id: `advance-to-ambiguous-${attempt}`,
        action: "nextHunk",
      }));
      const next = await WaitForFrame(socket, "command_result");
      assert.equal(next.result.ok, true);
      current = next.state.currentHunk;
    }
    assert.equal(current.hunkId, target.hunkId);

    socket.send(JSON.stringify({
      type: "command",
      id: "stage-ambiguous-insertion",
      action: "stage",
      hunkId: current.hunkId,
      patchHash: current.patchHash,
    }));
    const staged = await WaitForFrame(socket, "command_result");
    assert.equal(staged.result.ok, true, JSON.stringify(staged.result));

    const cached = await Git(repoRoot, ["diff", "--cached", "--unified=0", "--", fileRel]);
    const unstaged = await Git(repoRoot, ["diff", "--unified=0", "--", fileRel]);
    const AddedLines = (diff: string): string[] =>
      diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
    assert.match(cached, /SmartGrid::Color color = TheNonagonSmartGrid::VoiceColor\(voiceIx\)/);
    assert.deepEqual(AddedLines(cached), AddedLines(current.patch));
    assert.doesNotMatch(cached, /\+            auto& sourceUIState = m_uiState->m_voiceSourceUIState\[voiceIx\]/);
    assert.doesNotMatch(unstaged, /-            SmartGrid::Color color = TheNonagonSmartGrid::VoiceColor\(voiceIx\)/);
    assert.doesNotMatch(unstaged, /\+            SmartGrid::Color color = TheNonagonSmartGrid::VoiceColor\(voiceIx\)/);
    assert.match(unstaged, /sourceUIState\.m_sourceMachine\.load\(\) != SourceMachine::Thru/);

    socket.send(JSON.stringify({
      type: "command",
      id: "undo-ambiguous-insertion-stage",
      action: "undo",
    }));
    const undone = await WaitForFrame(socket, "command_result");
    assert.equal(undone.result.ok, true, JSON.stringify(undone.result));

    const cachedAfterUndo = await Git(repoRoot, ["diff", "--cached", "--unified=0", "--", fileRel]);
    const unstagedAfterUndo = await Git(repoRoot, ["diff", "--unified=0", "--", fileRel]);
    assert.doesNotMatch(cachedAfterUndo, /SmartGrid::Color color = TheNonagonSmartGrid::VoiceColor\(voiceIx\)/);
    assert.match(unstagedAfterUndo, /\+            SmartGrid::Color color = TheNonagonSmartGrid::VoiceColor\(voiceIx\)/);
    assert.match(unstagedAfterUndo, /sourceUIState\.m_sourceMachine\.load\(\) != SourceMachine::Thru/);

    await CloseSocket(socket);
  });
});

test("Agent Review keeps completed-file no-focus state across a plain refresh", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateThreeFileReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    await WaitForFrame(socket, "bootstrap");
    socket.send(JSON.stringify({ type: "command", id: "middle-file", action: "nextFile" }));
    const middle = await WaitForFrame(socket, "command_result");
    assert.equal(middle.state.currentHunk.file, "projects/demo/beta.ts");

    socket.send(JSON.stringify({
      type: "command",
      id: "complete-middle-file",
      action: "stage",
      hunkId: middle.state.currentHunk.hunkId,
      patchHash: middle.state.currentHunk.patchHash,
    }));
    const completedMiddle = await WaitForFrame(socket, "command_result");
    assert.equal(completedMiddle.result.ok, true);
    assert.equal(completedMiddle.state.currentHunk, null);

    const alpha = completedMiddle.state.hunks.find(
      (hunk: Record<string, any>) => hunk.file === "projects/demo/alpha.ts",
    );
    assert.ok(alpha);
    socket.send(JSON.stringify({
      type: "comment",
      hunkId: alpha.hunkId,
      text: "Still needs review.",
    }));
    const refreshed = await WaitForFrame(socket, "state");
    assert.equal(refreshed.state.currentHunk, null);
    assert.equal(refreshed.state.actions.canGoNextFile, true);

    socket.send(JSON.stringify({ type: "command", id: "next-after-refresh", action: "nextFile" }));
    const afterNext = await WaitForFrame(socket, "command_result");
    assert.equal(afterNext.result.ok, true);
    assert.equal(afterNext.state.currentHunk.file, "projects/demo/charlie.ts");

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review selects a completed anchor file when it gains a reappearing hunk", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, betaPath } = await CreateThreeFileReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) =>
    {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });

    await WaitForFrame(socket, "bootstrap");
    socket.send(JSON.stringify({ type: "command", id: "middle-file", action: "nextFile" }));
    const middle = await WaitForFrame(socket, "command_result");
    assert.equal(middle.state.currentHunk.file, "projects/demo/beta.ts");

    socket.send(JSON.stringify({
      type: "command",
      id: "complete-middle-file",
      action: "stage",
      hunkId: middle.state.currentHunk.hunkId,
      patchHash: middle.state.currentHunk.patchHash,
    }));
    const completedMiddle = await WaitForFrame(socket, "command_result");
    assert.equal(completedMiddle.result.ok, true);
    assert.equal(completedMiddle.state.currentHunk, null);

    await writeFile(betaPath, "line 1\nbeta changed\nbeta reappearing hunk\n", "utf8");
    const alpha = completedMiddle.state.hunks.find(
      (hunk: Record<string, any>) => hunk.file === "projects/demo/alpha.ts",
    );
    assert.ok(alpha);
    socket.send(JSON.stringify({
      type: "comment",
      hunkId: alpha.hunkId,
      text: "Trigger a plain refresh.",
    }));
    const refreshed = await WaitForFrame(socket, "state");
    assert.equal(refreshed.state.currentHunk.file, "projects/demo/beta.ts");
    assert.match(refreshed.state.currentHunk.patch, /beta reappearing hunk/);

    await new Promise<void>((resolve) =>
    {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

test("Agent Review Launchpad clears and restores around tab focus", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");

      // Focused on attach: the next-hunk cell is lit.
      const lit = await fakeDictator.waitForRequest("launchpad.setCells");
      assert.deepEqual(CellMap(lit.params.cells).get("1,3"), { x: 1, y: 3, r: 255, g: 255, b: 0 });

      // Record broadcast hunk indices; an ignored press emits none.
      const seen: number[] = [];
      const reachedNextHunk = new Promise<void>((resolve) =>
      {
        const onMessage = (raw: WebSocket.RawData): void =>
        {
          const frame = JSON.parse(raw.toString()) as Record<string, any>;
          if (frame.type === "state" && frame.state.currentHunk != null)
          {
            seen.push(frame.state.currentHunk.hunkIndex);
            if (frame.state.currentHunk.hunkIndex === 1)
            {
              socket.off("message", onMessage);
              resolve();
            }
          }
        };
        socket.on("message", onMessage);
      });

      // Unfocused: every owned cell goes off regardless of availability.
      fakeDictator.clearRequests();
      socket.send(JSON.stringify({ type: "presence", focused: false }));
      const dark = await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        (req) => AllCellsOff(req.params.cells),
      );
      assert.deepEqual(CellMap(dark.params.cells).get("1,3"), { x: 1, y: 3, off: true });
      assert.deepEqual(CellMap(dark.params.cells).get("3,3"), { x: 3, y: 3, off: true });

      // A press during the unfocused window is dropped.
      fakeDictator.sendPress(1, 3);

      // Refocus restores the lit cells from current state.
      fakeDictator.clearRequests();
      socket.send(JSON.stringify({ type: "presence", focused: true }));
      await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        (req) => CellMap(req.params.cells).get("1,3")?.off !== true,
      );

      // The focused press advances; the only broadcast index is from this press.
      fakeDictator.sendPress(1, 3);
      await reachedNextHunk;
      assert.deepEqual(seen, [1]);

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad stays dark on a state refresh while unfocused", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");

      socket.send(JSON.stringify({ type: "presence", focused: false }));
      await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        (req) => AllCellsOff(req.params.cells),
      );

      // A state-changing command still refreshes state and runs the cell update,
      // but the gate keeps the grid dark rather than relighting available actions.
      fakeDictator.clearRequests();
      const advanced = WaitForFrameWhere(
        socket,
        "command_result",
        (frame) => frame.state.currentHunk?.hunkIndex === 1,
        "nextHunk while unfocused",
      );
      socket.send(JSON.stringify({ type: "command", action: "nextHunk" }));
      await advanced;

      const afterRefresh = await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        () => true,
      );
      assert.deepEqual(CellMap(afterRefresh.params.cells).get("1,3"), { x: 1, y: 3, off: true });

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Launchpad stays active while any client is focused", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
      const socketA = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socketA.once("open", () => resolve());
        socketA.once("error", reject);
      });
      await WaitForFrame(socketA, "bootstrap");

      const socketB = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socketB.once("open", () => resolve());
        socketB.once("error", reject);
      });
      await WaitForFrame(socketB, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");

      // A goes unfocused, but B is still focused, so the grid stays active and a
      // press is still handled.
      socketA.send(JSON.stringify({ type: "presence", focused: false }));
      const advanced = WaitForFrameWhere(
        socketB,
        "state",
        (frame) => frame.state.currentHunk?.hunkIndex === 1,
        "advance while B focused",
      );
      fakeDictator.sendPress(1, 3);
      const state = await advanced;
      assert.equal(state.state.currentHunk.hunkIndex, 1);

      await new Promise<void>((resolve) =>
      {
        socketA.once("close", () => resolve());
        socketA.close();
      });
      await new Promise<void>((resolve) =>
      {
        socketB.once("close", () => resolve());
        socketB.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review Dictator RPC sends heartbeat pings during quiet review sessions", async () =>
{
  const priorHeartbeat = process.env.SHEAF_CHAT_AGENT_REVIEW_RPC_HEARTBEAT_MS;
  process.env.SHEAF_CHAT_AGENT_REVIEW_RPC_HEARTBEAT_MS = "25";

  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      await WaitForFrame(socket, "bootstrap");
      await fakeDictator.waitForRequest("launchpad.setCells");

      fakeDictator.clearRequests();
      await fakeDictator.waitForRequest("rpc.ping", 1000);

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    if (priorHeartbeat === undefined)
    {
      delete process.env.SHEAF_CHAT_AGENT_REVIEW_RPC_HEARTBEAT_MS;
    }
    else
    {
      process.env.SHEAF_CHAT_AGENT_REVIEW_RPC_HEARTBEAT_MS = priorHeartbeat;
    }
    await fakeDictator.close();
  }
});

test("Agent Review reconnects and repaints Launchpad cells after Dictator expires the RPC session", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      const bootstrap = await WaitForFrame(socket, "bootstrap");
      const hunk = bootstrap.state.currentHunk;
      await fakeDictator.waitForRequest("launchpad.setCells");

      fakeDictator.clearRequests();
      fakeDictator.failNextRequest("launchpad.setCells", {
        code: "invalid_request",
        message: "client session not found",
      });

      socket.send(JSON.stringify({
        type: "comment",
        hunkId: hunk.hunkId,
        text: "Please simplify this branch.",
      }));
      await WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.reviewDraft.entries.length === 1,
        "commented draft state",
      );

      const repainted = await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        (request) =>
          fakeDictator.connectionCount > 1 &&
          CellMap(request.params.cells).get("3,3")?.b === 255,
      );
      assert.equal(fakeDictator.connectionCount, 2);
      assert.deepEqual(CellMap(repainted.params.cells).get("3,3"), { x: 3, y: 3, r: 0, g: 0, b: 255 });

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review stale-session repaint failure preserves the browser review draft", async () =>
{
  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  try
  {
    await WithTestServer(async (handle) =>
    {
      await writeFile(
        handle.config.paths.servicesJsonFile,
        JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
        "utf8",
      );

      const { repoId, workspaceId } = await CreateGitReviewSession(handle);
      const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
      await new Promise<void>((resolve, reject) =>
      {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      const bootstrap = await WaitForFrame(socket, "bootstrap");
      const hunk = bootstrap.state.currentHunk;
      await fakeDictator.waitForRequest("launchpad.setCells");

      fakeDictator.clearRequests();
      fakeDictator.failNextRequest("launchpad.setCells", {
        code: "invalid_request",
        message: "client session not found",
      });
      fakeDictator.failNextRequest("launchpad.setCells", {
        code: "invalid_request",
        message: "client session not found",
      });

      socket.send(JSON.stringify({
        type: "comment",
        hunkId: hunk.hunkId,
        text: "Please simplify this branch.",
      }));
      const commented = await WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.reviewDraft.entries.length === 1,
        "commented draft state",
      );
      assert.equal(commented.state.reviewDraft.entries[0].text, "Please simplify this branch.");

      await fakeDictator.waitForRequestWhere(
        "launchpad.setCells",
        () => fakeDictator.connectionCount > 1,
      );

      assert.equal(socket.readyState, WebSocket.OPEN);
      socket.send(JSON.stringify({ type: "focus", hunkId: null }));
      const away = await WaitForFrameWhere(
        socket,
        "state",
        (frame) => frame.state.currentHunk === null,
        "away state after failed repaint",
      );
      assert.equal(away.state.reviewDraft.entries[0].text, "Please simplify this branch.");
      assert.equal(away.state.reviewDraft.hasSerializedContent, true);

      await new Promise<void>((resolve) =>
      {
        socket.once("close", () => resolve());
        socket.close();
      });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});

test("Agent Review teardown waits for in-flight git work before completing", async () =>
{
  const rejections: unknown[] = [];
  const onUnhandled = (reason: unknown): void =>
  {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  const fakeDictator = new FakeDictatorRPCServer();
  const dictatorPort = await fakeDictator.start();
  let releaseGit: (() => void) | null = null;
  try
  {
    await WithFakeRepoAsync(async (repoRoot) =>
    {
      const handle = await StartTestServer(repoRoot);
      try
      {
        await writeFile(
          handle.config.paths.servicesJsonFile,
          JSON.stringify([{ name: "dictator", host: "127.0.0.1", port: dictatorPort }]),
          "utf8",
        );

        const { repoId, workspaceId } = await CreateMultiHunkReviewSession(handle);
        const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
        await new Promise<void>((resolve, reject) =>
        {
          socket.once("open", () => resolve());
          socket.once("error", reject);
        });
        await WaitForFrame(socket, "bootstrap");
        await fakeDictator.waitForRequest("launchpad.setCells");

        // Arm a one-shot git gate: the next git invocation (the press's refresh)
        // blocks until we release it, holding command work deterministically in
        // flight.
        let signalGitStarted: () => void = () => {};
        const gitStarted = new Promise<void>((resolve) => { signalGitStarted = resolve; });
        const gate = new Promise<void>((resolve) => { releaseGit = resolve; });
        let armed = true;
        SetAgentReviewGitHookForTests(async () =>
        {
          if (!armed)
          {
            return;
          }
          armed = false;
          signalGitStarted();
          await gate;
        });

        fakeDictator.sendPress(1, 3); // next-hunk -> ExecuteCommand -> git
        await gitStarted;             // git is now in flight, blocked on the gate

        // Tear down while git is in flight. A correct lifecycle drains in-flight
        // work, so close must NOT resolve until the gate is released.
        const close = handle.close();
        const winner = await Promise.race([
          close.then(() => "closed"),
          new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 200)),
        ]);
        assert.equal(winner, "pending", "teardown resolved before in-flight git settled");

        releaseGit?.();               // let git finish against the still-present repo
        releaseGit = null;
        await close;                  // teardown now completes cleanly
      }
      finally
      {
        SetAgentReviewGitHookForTests(null);
        releaseGit?.();               // never leave git blocked on a failure path
      }
    });

    // The repository is removed only after teardown completed (callback return).
    // Give any incorrectly-detached async work a chance to surface.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  finally
  {
    await fakeDictator.close();
    process.off("unhandledRejection", onUnhandled);
  }

  assert.deepEqual(rejections, []);
});
