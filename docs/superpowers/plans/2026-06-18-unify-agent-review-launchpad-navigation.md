# Unify Agent Review Launchpad Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Review browser controls and matching Launchpad cells execute the same commands and drive the unified file viewer identically.

**Architecture:** Treat Launchpad navigation and mutation cells as input adapters that synthesize the same Agent Review command/result model used by browser WebSocket commands. The browser UI must follow authoritative command-result state regardless of whether the command came from a browser click or a fake/real Dictator RPC `launchpad.cellPressed` event.

**Tech Stack:** TypeScript, Node test runner, WebSocket `ws`, Sheaf Chat browser harness tests, Sheaf Chat REST/WebSocket tests, SwiftPM Dictator tests for external Launchpad cell forwarding.

---

## File Structure

- Modify `projects/sheaf-chat/src/server/agentReview/service.ts`
  - Add Launchpad command ids with `launchpad:` diagnostic prefix.
  - Have Launchpad-originated navigation/mutation cells broadcast the same `command_result` frames as browser commands.
  - Keep `(3,3)` review/comment/post behavior separate.
- Modify `projects/sheaf-chat/src/ui/sheaf-chat.js`
  - Make successful command-result state open/reveal the authoritative current hunk file without requiring browser-local `pendingCommandResult`.
  - Prevent focus synchronization from steering the service back to the old selected file after a command-originated state update.
- Modify `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
  - Add fake Dictator RPC tests for Launchpad cross-file navigation, file-anchor navigation, command ids, and disabled-action no-op behavior.
- Modify `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
  - Add paired browser/Launchpad-simulated command-result flows for the unified file viewer.
  - Assert selected tab, focused rows, scroll target, and absence of focus-steering regressions.
- Modify `openspec/changes/unify-agent-review-launchpad-navigation/tasks.md`
  - Mark OpenSpec tasks complete only after verified.
- Maybe modify `projects/sheaf-chat/docs/coverage.md`
  - Only if current coverage docs track Agent Review input parity gaps.

---

### Task 1: RED Server Launchpad Command-Result Parity

**Files:**
- Modify: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`

- [ ] **Step 1: Add a failing test for Launchpad next-file command results**

Add a test near the existing Launchpad tests:

```ts
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
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
cd projects/sheaf-chat
/opt/homebrew/bin/npm test -- --test-name-pattern "Agent Review Launchpad next-file cell emits command result and advances file"
```

Expected now: FAIL or timeout because Launchpad `HandleCellPressed()` currently executes the command and broadcasts plain `state`, but does not emit `command_result`.

---

### Task 2: GREEN Server Launchpad Command-Result Parity

**Files:**
- Modify: `projects/sheaf-chat/src/server/agentReview/service.ts`
- Test: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`

- [ ] **Step 1: Add a Launchpad command id counter and helper**

In `AgentReviewSession`, add a private counter field near other session fields:

```ts
private m_launchpadCommandSequence = 0;
```

Add a helper:

```ts
private NextLaunchpadCommandId(): string
{
  this.m_launchpadCommandSequence += 1;
  return `launchpad:${this.m_launchpadCommandSequence}`;
}
```

- [ ] **Step 2: Extract command-result broadcast**

Add:

```ts
private BroadcastCommandResult(result: AgentReviewCommandResult): void
{
  const state = this.RequireState();
  for (const client of this.m_sockets)
  {
    SendFrame(client, {
      type: "command_result",
      result,
      state,
    });
  }
}
```

Replace the browser command branch in `HandleMessage()` with:

```ts
const result = await this.ExecuteCommand(frame.action, {
  commandId: frame.id,
  hunkId: frame.hunkId,
  patchHash: frame.patchHash,
});
this.BroadcastCommandResult(result);
```

- [ ] **Step 3: Use the same result path for Launchpad navigation/mutation cells**

In `HandleCellPressed()`, replace:

```ts
await this.ExecuteCommand(cell.action, {});
```

with:

```ts
const result = await this.ExecuteCommand(cell.action, {
  commandId: this.NextLaunchpadCommandId(),
});
this.BroadcastCommandResult(result);
```

Do not change the `(3,3)` branch.

- [ ] **Step 4: Run the focused server test to verify GREEN**

Run:

```bash
cd projects/sheaf-chat
/opt/homebrew/bin/npm test -- --test-name-pattern "Agent Review Launchpad next-file cell emits command result and advances file"
```

Expected: PASS for the new test.

---

### Task 3: RED UI Command-Result Origin Parity

**Files:**
- Modify: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`

- [ ] **Step 1: Add a helper for Agent Review file-tab assertions**

Near existing Agent Review UI helpers, add:

```ts
function AssertSelectedFileTab(root: FakeElement, expectedPath: string): void
{
  assert.ok(
    Array.from(root.querySelectorAll(".sheaf-chat-tab--selected")).some((tab) =>
      tab.textContent.includes(expectedPath),
    ),
    `expected selected tab to include ${expectedPath}`,
  );
}
```

- [ ] **Step 2: Add a failing Launchpad-origin command-result UI test**

Add a UI test based on `unified file viewer jumps from a non-hunk file to the next hunk file`, but do not click the browser button. Instead, after anchoring on `aardvark.ts`, inject:

```ts
reviewSocket.receive({
  type: "command_result",
  result: { ok: true, action: "nextFile", commandId: "launchpad:1" },
  state: focusedState,
});
```

Then assert:

```ts
await FlushPromises();
harness.flushAnimationFrames();
RequiredElement(harness.app, ".sheaf-chat-agent-review-inline");
AssertSelectedFileTab(harness.app, "app.ts");
const sentAfterResult = reviewSocket.sent.map((raw) => JSON.parse(raw) as Record<string, any>);
assert.notEqual(sentAfterResult.at(-1)?.file, "aardvark.ts");
```

- [ ] **Step 3: Run the UI test to verify RED**

Run:

```bash
cd projects/sheaf-chat
/opt/homebrew/bin/npm test -- --test-name-pattern "unified file viewer follows Launchpad-origin Agent Review command results"
```

Expected now: FAIL because `ApplyReviewState()` only opens a different current hunk file when browser-local `pendingCommandResult` is set.

---

### Task 4: GREEN UI Command-Result Origin Parity

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Test: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`

- [ ] **Step 1: Add command-result origin state**

Replace the current `pendingCommandResult` boolean with a name that means "the current state came from any command result", such as:

```js
pendingCommandResult: false,
```

Keep the storage field if minimal, but set it from incoming `command_result` frames, not only browser clicks.

- [ ] **Step 2: Set command-result state in socket message handling**

In the `frame.type === "command_result"` handler before `ApplyReviewState(frame.state)`, set:

```js
review.pendingCommandResult = true;
```

Browser clicks may still set the flag early, but correctness must not depend on that early local set.

- [ ] **Step 3: Ensure successful command-result state opens the authoritative current file**

Keep `ApplyReviewState()` logic so `shouldOpenCurrent` is true when `pendingCommandResult` is true and `current.file !== state.selectedPath`. Because Launchpad command results now set the same flag, the unified viewer follows Launchpad-origin commands.

- [ ] **Step 4: Guard focus synchronization during command-result file switching**

When `OpenFile(current.file)` is triggered from command-result state, ensure `lastFocusKey` does not immediately cause a `focus` frame for the previously selected file. A minimal acceptable implementation is:

```js
if (shouldOpenCurrent && state.selectedPath !== current.file) {
  state.agentReview.lastFocusKey = "hunk:" + current.hunkId;
  renderSelectedFileNow = false;
  OpenFile(current.file);
}
```

Then let the normal selected-file render and focus synchronization observe the authoritative file/hunk.

- [ ] **Step 5: Run the focused UI test to verify GREEN**

Run:

```bash
cd projects/sheaf-chat
/opt/homebrew/bin/npm test -- --test-name-pattern "unified file viewer follows Launchpad-origin Agent Review command results"
```

Expected: PASS.

---

### Task 5: Broaden Paired Browser/Launchpad Coverage

**Files:**
- Modify: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
- Modify: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`

- [ ] **Step 1: Extend server fake RPC tests**

Add or extend tests so fake Launchpad presses cover:

- `sendPress(1, 3)` next hunk: emits `command_result` with `action: "nextHunk"` and `commandId` prefix `launchpad:`.
- `sendPress(2, 3)` next file: emits `command_result` with `action: "nextFile"`.
- file-anchor navigation after a `focus { hunkId: null, file }` frame.
- unavailable `sendPress(3, 2)` undo: emits no command result and does not change state.

- [ ] **Step 2: Extend UI paired tests**

Add paired browser and Launchpad-origin command-result assertions for:

- same-file next hunk
- cross-file next file
- non-hunk selected file next file
- stage/revert/undo post-command state

Use existing fake states and `reviewSocket.receive({ type: "command_result", ... })` for Launchpad-origin UI tests; do not rely on browser button clicks for the Launchpad half.

- [ ] **Step 3: Run the focused Agent Review tests**

Run:

```bash
cd projects/sheaf-chat
/opt/homebrew/bin/npm test -- --test-name-pattern "Launchpad|unified file viewer|Agent Review Mode opens review socket|Agent Review Mode shows unstaged-hunk counts"
```

Expected: relevant Agent Review tests pass.

---

### Task 6: Coverage Docs And OpenSpec Checkboxes

**Files:**
- Maybe modify: `projects/sheaf-chat/docs/coverage.md`
- Modify: `openspec/changes/unify-agent-review-launchpad-navigation/tasks.md`

- [ ] **Step 1: Inspect coverage docs**

Run:

```bash
rg -n "Agent Review|Launchpad|input parity|arm-30|arm-" projects/sheaf-chat/docs/coverage.md
```

If coverage docs list Agent Review tests, add a concise entry for `arm-30` and the new paired tests. If they do not track this area, do not churn the docs.

- [ ] **Step 2: Mark completed OpenSpec tasks**

After tests pass, update each completed checkbox in `openspec/changes/unify-agent-review-launchpad-navigation/tasks.md` from `- [ ]` to `- [x]`.

---

### Task 7: Final Verification

**Files:**
- No code changes unless verification reveals failures.

- [ ] **Step 1: Run Sheaf Chat full test suite**

Run:

```bash
cd projects/sheaf-chat
/opt/homebrew/bin/npm test
```

Expected: all Sheaf Chat tests pass.

- [ ] **Step 2: Run Dictator focused Launchpad/RPC tests**

Run:

```bash
swift test --package-path projects/dictator --filter "LaunchpadTests/testExternalLaunchpadLayerRendersOwnedCellAndConsumesPressRelease|DictatorRPCServiceTests"
```

Expected: focused Dictator RPC and Launchpad tests pass.

- [ ] **Step 3: Confirm OpenSpec status**

Run:

```bash
openspec instructions apply --change "unify-agent-review-launchpad-navigation" --json
openspec status --change "unify-agent-review-launchpad-navigation"
```

Expected: all 19 tasks complete.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no whitespace errors; diff limited to the OpenSpec change, plan, Sheaf Chat Agent Review files/tests, and optional coverage docs.
