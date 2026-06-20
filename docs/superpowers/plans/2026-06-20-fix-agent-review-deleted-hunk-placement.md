# Fix Agent Review Deleted Hunk Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Agent Review inline diff documents so pure deleted rows appear at their original position in file order, including Git zero-context `+N,0` deletion ranges.

**Architecture:** The service already parses `git diff --unified=0` and builds file-scoped `inlineFiles` rows from parsed hunk metadata plus current worktree content. The fix stays server-side in the inline row builder: deletion-only hunks with `newCount === 0` are inserted after `newStart`, while replacements/additions continue using the existing insertion point.

**Tech Stack:** TypeScript, Node.js `node:test`, Sheaf Chat REST test harness, Git zero-context diffs.

---

## Source Requirements

OpenSpec change: `fix-agent-review-deleted-hunk-placement`

Files:
- `openspec/changes/fix-agent-review-deleted-hunk-placement/proposal.md`
- `openspec/changes/fix-agent-review-deleted-hunk-placement/design.md`
- `openspec/changes/fix-agent-review-deleted-hunk-placement/specs/sheaf-chat-agent-review-mode/spec.md`
- `openspec/changes/fix-agent-review-deleted-hunk-placement/tasks.md`

Requirement preserved:
- `arm-24 — Review state: Inline diff file documents`
- Scenario: `Pure deletion after context line`
- Required behavior: when Git reports a zero-context pure deletion hunk with a zero-length new-file range after an unchanged worktree line, the inline document places the preceding unchanged line before the deleted row and following unchanged rows after the deleted row.

## File Structure

Modify:
- `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
  - Add a REST/state regression using a real Git repo and the existing test server harness.
  - Assert row order, not just row presence.
- `projects/sheaf-chat/src/server/agentReview/git.ts`
  - Adjust the server-side inline diff document builder insertion point for `newCount === 0`.
- `openspec/changes/fix-agent-review-deleted-hunk-placement/tasks.md`
  - Mark task checkboxes complete only after the corresponding implementation and verification steps pass.

No new files are required for implementation.

## Task 1: Add Failing Pure-Deletion Row-Order Regression

**Files:**
- Modify: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`

- [ ] **Step 1: Add the regression test**

Insert this test after `Agent Review availability reports Git hunks under the workspace root` and before `Agent Review splits separated changed runs and keeps adjacent changes together`:

```ts
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
```

- [ ] **Step 2: Build before running the compiled test**

Run:

```bash
cd projects/sheaf-chat
npm run build
```

Expected: TypeScript build completes with exit code `0`.

- [ ] **Step 3: Run the targeted test and verify it fails**

Run:

```bash
cd projects/sheaf-chat
node --test dist/tests/server/rest/agentReview.test.js
```

Expected before implementation: the new test fails with the assertion message `expected deletion after opening brace`. This confirms the regression reproduces the reported placement bug.

- [ ] **Step 4: Commit the failing test only**

Run:

```bash
git add projects/sheaf-chat/tests/server/rest/agentReview.test.ts
git commit -m "test: cover Agent Review pure deletion placement"
```

Expected: commit succeeds and contains only the test file change.

## Task 2: Fix Zero-Length New-Range Insertion

**Files:**
- Modify: `projects/sheaf-chat/src/server/agentReview/git.ts`

- [ ] **Step 1: Update the inline insertion point**

In `BuildInlineFiles`, replace:

```ts
      PushCurrentFileContextUntil(hunk.newStart);
```

with:

```ts
      const insertionNewLineNumber = hunk.newCount === 0
        ? hunk.newStart + 1
        : hunk.newStart;
      PushCurrentFileContextUntil(insertionNewLineNumber);
```

Do not change row id generation, `hunkId`, `oldLineNumber`, `newLineNumber`, or the serialized `inlineFiles` shape.

- [ ] **Step 2: Run the targeted test and verify it passes**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/server/rest/agentReview.test.js
```

Expected: the compiled `agentReview.test.js` run exits `0`. The new pure-deletion test passes, and existing Agent Review REST/state tests continue to pass.

- [ ] **Step 3: Inspect the implementation diff**

Run:

```bash
git diff -- projects/sheaf-chat/src/server/agentReview/git.ts projects/sheaf-chat/tests/server/rest/agentReview.test.ts
```

Expected:
- Test adds only the boundary-shaped pure-deletion fixture and row-order assertions.
- Implementation changes only the insertion point for `newCount === 0`.
- No client protocol or UI shape changes.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add projects/sheaf-chat/src/server/agentReview/git.ts
git commit -m "fix: place Agent Review pure deletions after context"
```

Expected: commit succeeds and contains only the implementation file change.

## Task 3: Verify Broadly And Sync OpenSpec Tasks

**Files:**
- Modify: `openspec/changes/fix-agent-review-deleted-hunk-placement/tasks.md`

- [ ] **Step 1: Run the Sheaf Chat project test command**

Run:

```bash
make sheaf-chat-test
```

Expected: Sheaf Chat build and test suite pass with exit code `0`.

- [ ] **Step 2: Mark OpenSpec tasks complete**

Edit `openspec/changes/fix-agent-review-deleted-hunk-placement/tasks.md` so every checkbox changes from `- [ ]` to `- [x]`:

```md
## 1. Regression Coverage

- [x] 1.1 Add an Agent Review state test that creates a real Git pure-deletion hunk after an unchanged context line and asserts inline row order is context-before, deletion, context-after.
- [x] 1.2 Include a boundary-shaped fixture similar to a struct opening brace so the deleted row must remain inside the block where it originally appeared.

## 2. Core Implementation

- [x] 2.1 Update the inline diff document builder to treat hunks with `newCount === 0` as inserting after `newStart` while leaving non-zero new ranges on the existing insertion path.
- [x] 2.2 Preserve existing row ids, hunk ids, old/new line metadata, and client-facing state shape.

## 3. Verification

- [x] 3.1 Run the targeted Sheaf Chat Agent Review tests covering REST/state inline diff output.
- [x] 3.2 Run the broader Sheaf Chat test command used for this project if the targeted test command passes.
- [x] 3.3 Confirm the OpenSpec change status is apply-ready after implementation tasks are complete.
```

- [ ] **Step 3: Confirm OpenSpec apply progress**

Run:

```bash
openspec instructions apply --change "fix-agent-review-deleted-hunk-placement" --json
```

Expected JSON contains:

```json
"progress": {
  "total": 7,
  "complete": 7,
  "remaining": 0
}
```

- [ ] **Step 4: Run final status checks**

Run:

```bash
openspec status --change "fix-agent-review-deleted-hunk-placement"
git status --short
```

Expected:
- OpenSpec reports all artifacts complete.
- `git status --short` shows only intentional changes for this implementation and any unrelated pre-existing worktree changes called out separately.

- [ ] **Step 5: Commit OpenSpec task sync**

Run:

```bash
git add openspec/changes/fix-agent-review-deleted-hunk-placement/tasks.md
git commit -m "docs: mark deleted hunk placement tasks complete"
```

Expected: commit succeeds and contains only the OpenSpec task checklist update.

## Review Checklist

- Spec coverage: Task 1 covers `arm-24` pure deletion row order, Task 2 implements the server-side row order fix, Task 3 verifies and syncs OpenSpec progress.
- Protocol safety: no REST or WebSocket state fields are added, removed, or renamed.
- Behavioral scope: only `newCount === 0` hunks shift insertion point; replacement/addition/mixed hunks stay on the existing path.
- Test evidence: targeted compiled Agent Review REST tests pass before broad `make sheaf-chat-test`.
