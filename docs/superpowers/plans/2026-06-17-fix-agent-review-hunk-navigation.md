# Fix Agent Review Hunk Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sheaf Chat Agent Review reliably mutate the selected hunk, preserve explicit file navigation semantics, keep armed review paste available while unfocused, and verify inline hunk reveal context.

**Architecture:** Keep Agent Review state owned by Sheaf Chat. Server fixes live in `src/server/agentReview/service.ts` and `git.ts`; browser fixes live in `src/ui/sheaf-chat.js`; tests use existing fake Git repositories, fake Agent Review WebSocket clients, fake Dictator RPC, and the UI fake DOM harness.

**Tech Stack:** TypeScript, Node `node:test`, `ws`, Git command-line fixtures, Sheaf Chat fake DOM UI harness, optional Playwright browser verification if installed.

---

## File Structure

- `projects/sheaf-chat/src/server/agentReview/git.ts`: Git hunk loading and patch application helpers. Add exported helper only if service-level verification needs it; prefer reusing `LoadAgentReviewGitState`.
- `projects/sheaf-chat/src/server/agentReview/service.ts`: current hunk validation, post-mutation refresh/focus policy, Dictator cell painting and press handling.
- `projects/sheaf-chat/src/ui/sheaf-chat.js`: inline reveal target helper; preserve current render structure.
- `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`: server WebSocket, fake Git repo, and fake Dictator RPC coverage.
- `projects/sheaf-chat/tests/ui/chatScreen.test.ts`: fake DOM UI coverage for inline reveal and randomized workflow with fake WebSocket.
- `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`: mark OpenSpec checkboxes only after implementation, review, and verification of the corresponding work.

## Task 1: Server Hunk Mutation And File-Boundary Focus

**Files:**
- Modify: `projects/sheaf-chat/src/server/agentReview/service.ts`
- Modify if needed: `projects/sheaf-chat/src/server/agentReview/git.ts`
- Test: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
- Update after verification: `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`

- [ ] **Step 1: Write failing tests for non-first hunk mutation and no auto-advance**

Add a fixture helper near `CreateMultiHunkReviewSession`:

```ts
async function CreateMultiFileBoundaryReviewSession(
  handle: TestServerHandle,
): Promise<{ repoId: string; workspaceId: string; repoRoot: string; alphaPath: string; betaPath: string }>
{
  const repoRoot = handle.agentManager.storagePaths.repoRoot;
  const demoRoot = path.join(repoRoot, "projects/demo");
  const created = await CreateWorkspaceChatViaApi(handle, demoRoot);
  const alphaPath = path.join(demoRoot, "alpha.ts");
  const betaPath = path.join(demoRoot, "beta.ts");
  const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);

  await mkdir(demoRoot, { recursive: true });
  await Git(repoRoot, ["init"]);
  await Git(repoRoot, ["config", "user.email", "test@example.com"]);
  await Git(repoRoot, ["config", "user.name", "Test User"]);
  await writeFile(alphaPath, `${base.join("\n")}\n`, "utf8");
  await writeFile(betaPath, `${base.join("\n")}\n`, "utf8");
  await Git(repoRoot, ["add", "."]);
  await Git(repoRoot, ["commit", "-m", "initial"]);

  const alpha = base.slice();
  alpha[1] = "line 2 changed";
  alpha[26] = "line 27 changed";
  await writeFile(alphaPath, `${alpha.join("\n")}\n`, "utf8");

  const beta = base.slice();
  beta[14] = "line 15 changed";
  await writeFile(betaPath, `${beta.join("\n")}\n`, "utf8");

  return { repoId: created.repoId, workspaceId: created.workspaceId, repoRoot, alphaPath, betaPath };
}
```

Add tests:

```ts
test("Agent Review stages and reverts a non-first hunk without mutating siblings", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId, repoRoot, alphaPath } =
      await CreateMultiFileBoundaryReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) => {
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
    const cached = await Git(repoRoot, ["diff", "--cached", "--unified=0", "--", "projects/demo/alpha.ts"]);
    const unstaged = await Git(repoRoot, ["diff", "--unified=0", "--", "projects/demo/alpha.ts"]);
    assert.match(cached, /line 27 changed/);
    assert.doesNotMatch(cached, /line 2 changed/);
    assert.match(unstaged, /line 2 changed/);
    assert.doesNotMatch(unstaged, /line 27 changed/);

    socket.send(JSON.stringify({ type: "command", id: "undo-stage-alpha", action: "undo" }));
    const undoStage = await WaitForFrame(socket, "command_result");
    assert.equal(undoStage.result.ok, true);
    assert.equal((await Git(repoRoot, ["diff", "--cached", "--", "projects/demo/alpha.ts"])).trim(), "");

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
    assert.equal(await readFile(alphaPath, "utf8"), `${[
      "line 1", "line 2 changed", "line 3", "line 4", "line 5", "line 6", "line 7", "line 8", "line 9", "line 10",
      "line 11", "line 12", "line 13", "line 14", "line 15", "line 16", "line 17", "line 18", "line 19", "line 20",
      "line 21", "line 22", "line 23", "line 24", "line 25", "line 26", "line 27", "line 28", "line 29", "line 30",
    ].join("\n")}\n`);

    socket.send(JSON.stringify({ type: "command", id: "undo-revert-alpha", action: "undo" }));
    const undoRevert = await WaitForFrame(socket, "command_result");
    assert.equal(undoRevert.result.ok, true);
    assert.equal(undoRevert.state.reviewDraft.entries.length, 0);

    await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.close(); });
  });
});

test("Agent Review does not auto-advance to another file after completing a file", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { repoId, workspaceId } = await CreateMultiFileBoundaryReviewSession(handle);
    const socket = new WebSocket(WsUrl(handle.baseUrl, repoId, workspaceId));
    await new Promise<void>((resolve, reject) => {
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

    await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.close(); });
  });
});
```

- [ ] **Step 2: Run failing server tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/server/rest/agentReview.test.js --test-name-pattern "non-first hunk|does not auto-advance"
```

Expected before implementation: at least one assertion fails because focus normalizes to another hunk/file or non-first mutation behavior is not verified correctly.

- [ ] **Step 3: Implement mutation focus policy**

In `service.ts`, add state to remember a post-mutation file boundary:

```ts
private m_postMutationFile: string | null = null;
private m_postMutationPreferNoCrossFile = false;
```

Add helper:

```ts
private SelectCurrentIndexAfterRefresh(
  hunks: AgentReviewHunk[],
  proposedIndex: number,
  priorHunk: AgentReviewHunk | null | undefined,
  hadState: boolean,
): number
{
  if (this.m_postMutationPreferNoCrossFile && this.m_postMutationFile !== null)
  {
    const sameFileIndex = hunks.findIndex((hunk) => hunk.file === this.m_postMutationFile);
    this.m_postMutationFile = null;
    this.m_postMutationPreferNoCrossFile = false;
    return sameFileIndex >= 0 ? sameFileIndex : -1;
  }

  if (!hadState)
  {
    return NormalizeCurrentIndex(hunks, proposedIndex);
  }

  if (proposedIndex < 0 && this.m_focusClearedExplicitly)
  {
    return -1;
  }

  if (proposedIndex < 0 && priorHunk != null)
  {
    const sameFileIndex = hunks.findIndex((hunk) => hunk.file === priorHunk.file);
    if (sameFileIndex >= 0)
    {
      return sameFileIndex;
    }
  }

  return NormalizeCurrentIndex(hunks, proposedIndex);
}
```

Use it in `Refresh()` instead of the current fallback block. In `MutateCurrentHunk()` and `Undo()`, before applying the patch, set:

```ts
this.m_postMutationFile = hunk.file;
this.m_postMutationPreferNoCrossFile = true;
```

For `Undo()`, use `entry.hunk.file`.

- [ ] **Step 4: Implement command availability when no hunk is focused**

Update `ActionsFor()` so `currentIndex < 0` still allows file navigation when hunks remain:

```ts
if (hunks.length > 0 && currentIndex < 0)
{
  return {
    ...EmptyActions(),
    canGoNextFile: true,
    canGoPrevFile: false,
    canUndo,
  };
}
```

Update `Navigate()` so `nextFile` from no focused hunk selects the first available hunk, while mutation actions still require a focused hunk.

- [ ] **Step 5: Run green server tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/server/rest/agentReview.test.js --test-name-pattern "non-first hunk|does not auto-advance"
```

Expected: selected tests pass.

- [ ] **Step 6: Mark OpenSpec tasks**

After tests pass, update:

```md
- [x] 1.1 ...
- [x] 1.2 ...
- [x] 1.3 ...
- [x] 1.4 ...
- [x] 1.5 ...
- [x] 1.6 ...
- [x] 2.1 ...
- [x] 2.2 ...
- [x] 2.3 ...
- [x] 2.4 ...
```

## Task 2: Launchpad Armed Review Focus Gating

**Files:**
- Modify: `projects/sheaf-chat/src/server/agentReview/service.ts`
- Test: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
- Update after verification: `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`

- [ ] **Step 1: Write failing fake Dictator RPC tests**

Add a helper to inspect a cell:

```ts
function ReviewCellFromRequest(request: Record<string, any>): Record<string, unknown> | undefined
{
  return request.params.cells.find((cell: Record<string, unknown>) => cell.x === 3 && cell.y === 3);
}
```

Add a test:

```ts
test("Agent Review keeps armed review cell pasteable while unfocused", async () =>
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
      await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
      const bootstrap = await WaitForFrame(socket, "bootstrap");
      const hunk = bootstrap.state.currentHunk;
      await fakeDictator.waitForRequest("launchpad.setCells");

      socket.send(JSON.stringify({ type: "comment", hunkId: hunk.hunkId, text: "Please fix this." }));
      await WaitForFrameWhere(socket, "state", (frame) => frame.state.reviewDraft.entries.length === 1, "commented");
      socket.send(JSON.stringify({ type: "focus", hunkId: null }));
      await WaitForFrameWhere(socket, "state", (frame) => frame.state.currentHunk === null, "away");

      fakeDictator.clearRequests();
      socket.send(JSON.stringify({ type: "presence", focused: false }));
      const unfocusedCells = await fakeDictator.waitForRequest("launchpad.setCells");
      assert.deepEqual(ReviewCellFromRequest(unfocusedCells), { x: 3, y: 3, r: 0, g: 255, b: 0 });
      const cells = CellMap(unfocusedCells.params.cells);
      assert.deepEqual(cells.get("0,2"), { x: 0, y: 2, off: true });
      assert.deepEqual(cells.get("1,3"), { x: 1, y: 3, off: true });

      const insert = fakeDictator.waitForRequest("cursor.insertText");
      fakeDictator.sendPress(3, 3);
      await insert;
      assert.match(fakeDictator.insertedText ?? "", /Please fix this\./);

      await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.close(); });
    });
  }
  finally
  {
    await fakeDictator.close();
  }
});
```

Add a failed-paste variant that calls `fakeDictator.failNextRequest("cursor.insertText", { message: "paste failed" })` before pressing `(3,3)` and asserts the review draft still has one entry.

- [ ] **Step 2: Run failing tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/server/rest/agentReview.test.js --test-name-pattern "armed review cell"
```

Expected before implementation: review cell is off and/or press is ignored while unfocused.

- [ ] **Step 3: Implement review-cell exception**

In `UpdateDictatorCells()`, replace the all-off branch with:

```ts
if (!this.AnyClientFocused())
{
  const reviewColor = this.SerializedReview() === null ? "off" : "green";
  await this.m_dictatorRPC.setCellsWithStaleSessionRetry(reviewColor, EmptyActions());
}
else
{
  await this.m_dictatorRPC.setCellsWithStaleSessionRetry(this.ReviewCellColor(), this.m_state.actions);
}
```

In `HandleCellPressed()`, allow `(3,3)` while unfocused only when a serialized review exists:

```ts
if (this.m_closing)
{
  return;
}
if (!this.AnyClientFocused())
{
  if (x === REVIEW_CELL.x && y === REVIEW_CELL.y && this.SerializedReview() !== null)
  {
    await this.HandleReviewCellPressed();
  }
  return;
}
```

- [ ] **Step 4: Run green tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/server/rest/agentReview.test.js --test-name-pattern "armed review cell|Dictator RPC cell"
```

Expected: selected tests pass.

- [ ] **Step 5: Mark OpenSpec tasks**

After tests pass, mark tasks 3.1 through 3.4 complete in `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`.

## Task 3: Inline Reveal Target And UI Scroll Tests

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Test: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- Update after verification: `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`

- [ ] **Step 1: Make fake DOM expose browser-like `children`**

Change `FakeElement` so `children` is still iterable but not an Array for the reveal-target test. Minimal approach: add a method just for tests to replace `children` with an array-like object is too invasive; instead, add a focused unit test around a real browser if Playwright is available. If Playwright is not available, add a fake `HTMLCollection` class in the test and test through rendered elements by setting `parent.children` via `Object.defineProperty` for that test.

Use this fake collection:

```ts
class FakeHtmlCollection
{
  public readonly length: number;
  public constructor(private readonly x_items: FakeElement[])
  {
    this.length = x_items.length;
    x_items.forEach((item, index) => {
      (this as unknown as Record<number, FakeElement>)[index] = item;
    });
  }
  public item(index: number): FakeElement | null
  {
    return this.x_items[index] || null;
  }
  public [Symbol.iterator](): Iterator<FakeElement>
  {
    return this.x_items[Symbol.iterator]();
  }
}
```

- [ ] **Step 2: Write failing reveal tests**

Update the existing `"Agent Review Mode scrolls inline hunks with context"` test to assert row `row-1` for a hunk anchored at row 4 with three rows of context. Ensure the test fails before implementation by making `parent.children` non-Array for the review inline container:

```ts
const inline = RequiredElement(harness.app, ".sheaf-chat-agent-review-inline");
Object.defineProperty(inline, "children", {
  value: new FakeHtmlCollection(inline.children),
  configurable: true,
});
```

Expected assertions:

```ts
assert.equal(FakeElement.scrolledIntoView.at(-1)?.getAttribute("data-review-row-id"), "row-1");
assert.equal(FakeElement.scrolledIntoView.at(-1)?.getAttribute("data-hunk-id"), null);
```

Keep the near-start assertion:

```ts
assert.equal(FakeElement.scrolledIntoView.at(-1)?.getAttribute("data-review-row-id"), "start-row-1");
```

Add already-visible test by implementing `getBoundingClientRect()` and `scrollTo()` on `FakeElement` for a specific file view and changed rows, then assert no new `scrollIntoView` and no `scrollTo` call when all changed rows are inside the viewport.

- [ ] **Step 3: Run failing UI tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "scrolls inline hunks"
```

Expected before implementation: enough-context assertion fails because the anchor row is selected instead of the three-row context target.

- [ ] **Step 4: Implement reveal helper fix**

Change `ReviewHunkRevealTarget()` in `src/ui/sheaf-chat.js`:

```js
function ReviewHunkRevealTarget(anchor) {
  const parent = anchor && anchor.parentNode;
  const siblings = parent && parent.children ? Array.from(parent.children) : [];
  const index = siblings.indexOf(anchor);
  if (index < 0) {
    return anchor;
  }
  return siblings[Math.max(0, index - 3)] || anchor;
}
```

- [ ] **Step 5: Run green UI tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "scrolls inline hunks|already visible"
```

Expected: selected tests pass.

- [ ] **Step 6: Mark OpenSpec tasks**

After tests pass, mark tasks 4.1 through 4.3 complete in `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`.

## Task 4: Deterministic Randomized Agent Review Workflow Test

**Files:**
- Test: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- Update after verification: `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`

- [ ] **Step 1: Add seeded random helper**

Add near test helpers:

```ts
function Mulberry32(seed: number): () => number
{
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 2: Add fake Agent Review state model**

Use an in-test model with files `alpha.ts` and `beta.ts`, hunk ids `alpha-1`, `alpha-2`, `beta-1`, comments map, reverted set, staged set, undo stack, and current hunk id. Create a function `BuildReviewState(model)` that returns the same shape used by existing Agent Review UI tests.

- [ ] **Step 3: Add randomized test**

Add:

```ts
test("Agent Review randomized workflow preserves expected UI state", async () =>
{
  const seed = 0x5EAF2026;
  const random = Mulberry32(seed);
  const model = CreateRandomReviewModel();
  const harness = LoadChatHarness({ fetch: async (requestPath) => {
    if (requestPath.endsWith("/agent-review")) return JsonResponse(BuildReviewState(model));
    if (requestPath.includes("/files?path=")) return JsonResponse({ directory: { name: ".", path: ".", kind: "directory" }, entries: [] });
    if (requestPath.includes("/file?path=")) return JsonResponse({ file: { name: "alpha.ts", path: "alpha.ts", kind: "file", supported: true, contentType: "text/plain", content: "content\n", size: 8, modifiedAt: "2026-06-08T00:00:00.000Z" } });
    return JsonResponse({});
  }});
  await FlushPromises();
  RequiredElement(harness.app, ".sheaf-chat-agent-review-toggle").click();
  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, `missing review socket for seed ${seed}`);
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: BuildReviewState(model) });
  await FlushPromises();

  for (let step = 0; step < 40; step += 1)
  {
    const roll = random();
    ApplyRandomModelStep(model, roll);
    reviewSocket.receive({ type: "state", state: BuildReviewState(model) });
    await FlushPromises();
    harness.flushAnimationFrames();
    AssertReviewUiMatchesModel(harness.app, model, seed, step);
  }
});
```

Implement `ApplyRandomModelStep` to choose among next hunk, previous hunk, next file, previous file, add/edit comment, stage, revert, undo, and clear focus. Implement `AssertReviewUiMatchesModel` to check current counts text, focused row hunk ids, visible comment text box, disabled/enabled buttons, and sent frames after button clicks for at least one operation per category.

- [ ] **Step 4: Run randomized UI test**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "randomized workflow"
```

Expected: test passes and failure messages include seed and step.

- [ ] **Step 5: Mark OpenSpec tasks**

After tests pass, mark tasks 5.1 through 5.5 complete in `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`.

## Task 5: Final Verification And OpenSpec Sync

**Files:**
- Update: `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`
- Verify all modified files.

- [ ] **Step 1: Run targeted server tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/server/rest/agentReview.test.js
```

Expected: all Agent Review server tests pass.

- [ ] **Step 2: Run targeted UI tests**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm run build && node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "Agent Review"
```

Expected: all Agent Review UI tests pass.

- [ ] **Step 3: Run full Sheaf Chat test suite**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation/projects/sheaf-chat
npm test
```

Expected: test suite exits 0.

- [ ] **Step 4: Run OpenSpec status**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation
openspec status --change "fix-agent-review-hunk-navigation"
```

Expected: all artifacts complete and implementation tasks checked.

- [ ] **Step 5: Mark verification tasks**

Mark tasks 6.1 through 6.4 complete in `openspec/changes/fix-agent-review-hunk-navigation/tasks.md`.

- [ ] **Step 6: Review final diff**

Run:

```bash
cd /private/tmp/sheaf-fix-agent-review-hunk-navigation
git status --short
git diff --stat
git diff --check
```

Expected: only intended Agent Review source, tests, plan, and OpenSpec task files changed; `git diff --check` exits 0.

## Spec Coverage Self-Review

- arm-4 and arm-25 three-row reveal context: Task 3.
- arm-5 non-first hunk stage fidelity: Task 1.
- arm-6 non-first hunk revert fidelity and rejected marker: Task 1.
- arm-19 armed review focus-gating exception: Task 2.
- arm-27 no automatic cross-file mutation advance: Task 1.
- Randomized fake WebSocket workflow requested by proposal/tasks: Task 4.
- Verification and OpenSpec sync: Task 5.
