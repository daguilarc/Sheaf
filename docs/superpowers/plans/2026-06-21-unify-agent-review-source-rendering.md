# Unify Agent Review Source Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Review hunk-aware files use the same syntax-highlighted, Emacs-navigable source rendering pipeline as ordinary files, with hunk additions/deletions treated as addressable visible text.

**Architecture:** Introduce a focused browser-side source rendering module that turns normal files and Agent Review inline rows into one render document made of text segments plus optional hunk metadata. `sheaf-chat.js` will build render documents and apply Agent Review chrome; `sheaf-file-navigation.js` will navigate/decorate render-document offsets instead of raw DOM text that includes gutters.

**Tech Stack:** Browser JavaScript, Highlight.js, Node test runner, Playwright, existing Sheaf Chat fake/repo integration harnesses, OpenSpec change `unify-agent-review-source-rendering`.

---

## OpenSpec Source Of Truth

- Change: `openspec/changes/unify-agent-review-source-rendering/`
- Requirements: `fb-29`, `fb-38`, `arm-23`, `arm-24`
- OpenSpec tasks: `openspec/changes/unify-agent-review-source-rendering/tasks.md`
- Keep OpenSpec checkboxes synchronized only after implementation, review, and verification for the corresponding work are complete.

## File Structure

- Create: `projects/sheaf-chat/src/ui/sheaf-source-rendering.js`
  - Responsibility: render-document construction, Highlight.js text-segment rendering, DOM range decoration over addressable text segments, and textContent stability helpers.
- Modify: `projects/sheaf-chat/src/ui/index.html`
  - Responsibility: load `sheaf-source-rendering.js` before `sheaf-file-navigation.js` and `sheaf-chat.js`.
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
  - Responsibility: build normal and Agent Review render documents, preserve Agent Review controls/chrome, remove the hunk-only textContent renderer as a source text path.
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
  - Responsibility: use render-document text and DOM mapping for point, mark, search, prompt, and viewport behavior.
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.css`
  - Responsibility: keep existing hunk row visual treatments while allowing highlighted spans and navigation spans inside `.sheaf-chat-agent-review-inline-code`.
- Modify: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
  - Responsibility: fast mocked UI coverage for hunk-aware Highlight.js and basic point/search/mark projection.
- Modify: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`
  - Responsibility: no-hunk parity helpers for ordinary Highlight.js and Emacs behavior.
- Modify: `projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts`
  - Responsibility: real Git/Agent Review coverage for hunk-bearing syntax highlighting, pure insertion, pure deletion, edit, search, mark, and preservation of review behavior.
- Modify as needed: `projects/sheaf-chat/src/server/agentReview/types.ts`, `projects/sheaf-chat/src/server/agentReview/git.ts`
  - Responsibility: only add inline-row metadata if the browser cannot deterministically build virtual/source render ranges from existing row data.

### Task 1: Add Failing Hunk-Aware Highlighting And Emacs Tests

**Files:**
- Modify: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- Modify: `projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts`
- Read: `openspec/changes/unify-agent-review-source-rendering/specs/sheaf-chat-file-browser/spec.md`
- Read: `openspec/changes/unify-agent-review-source-rendering/specs/sheaf-chat-agent-review-mode/spec.md`

- [ ] **Step 1: Add a mocked UI Highlight.js regression test**

Add this test near the existing `text file previews use mapped Highlight.js languages` test in `projects/sheaf-chat/tests/ui/chatScreen.test.ts`. The initial expected result is failure because current Agent Review rows set `textContent` and never call Highlight.js.

```ts
test("Agent Review hunk-aware text files preserve Highlight.js token rendering", async () =>
{
  const calls: Array<{ code: string; language: string }> = [];
  const hunk = {
    sourceProvider: "sheaf-chat",
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    file: "main.cpp",
    hunkId: "hunk-edit",
    hunkIndex: 0,
    hunkCount: 1,
    fileIndex: 0,
    fileCount: 1,
    header: "@@ -1,2 +1,2 @@",
    patchHash: "abc123",
    patch: "diff --git a/main.cpp b/main.cpp\n@@ -1,2 +1,2 @@\n-int old_value = 1;\n+int new_value = 2;\n return new_value;\n",
  };
  const reviewState: any = {
    available: true,
    repoRoot: "/repo",
    sessionRoot: "/repo/projects/demo",
    sessionRootRelativeToRepo: "projects/demo",
    currentIndex: 0,
    currentHunk: hunk,
    hunks: [hunk],
    files: [{ file: "main.cpp", hunkCount: 1 }],
    inlineFiles: [{
      file: "main.cpp",
      rows: [
        { id: "old", kind: "deletion", text: "int old_value = 1;", hunkId: "hunk-edit", oldLineNumber: 1 },
        { id: "new", kind: "addition", text: "int new_value = 2;", hunkId: "hunk-edit", newLineNumber: 1 },
        { id: "ctx", kind: "context", text: "return new_value;", newLineNumber: 2 },
      ],
    }],
    actions: { canGoUp: false, canGoDown: false, canGoPrevFile: false, canGoNextFile: false, canStage: true, canRevert: true, canUndo: false },
    reviewDraft: { entries: [], visibleCommentHunkId: null, hasSerializedContent: false },
    dictatorBridge: { connected: false, url: null, lastError: null },
  };
  const harness = LoadChatHarness({
    fetch: async (requestPath) => {
      if (requestPath.endsWith("/agent-review")) return JsonResponse(reviewState);
      if (requestPath.includes("/files?path=")) {
        return JsonResponse({ directory: { name: ".", path: ".", kind: "directory" }, entries: [{ name: "main.cpp", path: "main.cpp", kind: "file", supported: true, contentType: "text/plain" }] });
      }
      if (requestPath.includes("/file?path=")) {
        return JsonResponse({ file: { name: "main.cpp", path: "main.cpp", kind: "file", supported: true, contentType: "text/plain", content: "int new_value = 2;\nreturn new_value;\n", size: 34, modifiedAt: "2026-06-21T00:00:00.000Z" } });
      }
      return JsonResponse({});
    },
    highlight: {
      getLanguage(language: string): boolean { return language === "cpp"; },
      highlight(code: string, options: { language: string }): { value: string } {
        calls.push({ code, language: options.language });
        return { value: code.replace(/\bint\b/g, '<span class="hljs-keyword">int</span>') };
      },
    },
  });
  await FlushPromises();
  const reviewSocket = harness.sockets.find((socket) => socket.url.includes("/ws/agent-review"));
  assert.ok(reviewSocket, "expected Agent Review WebSocket");
  reviewSocket.open();
  reviewSocket.receive({ type: "bootstrap", state: reviewState });
  await FlushPromises();
  harness.flushAnimationFrames();

  RequiredElement(harness.app, ".sheaf-chat-agent-review-inline");
  RequiredElement(harness.app, ".sheaf-chat-agent-review-inline-row--deletion .hljs-keyword");
  RequiredElement(harness.app, ".sheaf-chat-agent-review-inline-row--addition .hljs-keyword");
  assert.ok(calls.some((call) => call.language === "cpp" && call.code.includes("old_value")));
  assert.ok(calls.some((call) => call.language === "cpp" && call.code.includes("new_value")));
});
```

- [ ] **Step 2: Add a real Agent Review Chromium test for hunk Emacs behavior**

In `projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts`, add a test after `front door Agent Review renders inline diffs and stages focused hunks in Chromium`. Use `CreateFixtureRepo()`, set `HOME` to `fixture.homeDirectory`, modify a `.js` file in three ways, and assert search/mark works on added and deleted visible text. Use this fixture setup:

```ts
writeFileSync(
  path.join(fixture.repoPath, "review.js"),
  [
    "function kept() {",
    "  return 'context anchor';",
    "}",
    "",
    "function renamed() {",
    "  return 'new edit token';",
    "}",
    "",
    "function inserted() {",
    "  return 'insert only token';",
    "}",
  ].join("\n") + "\n",
  "utf8",
);
```

Before the modification, the committed file must contain `return 'old edit token';` and a pure-deletion block containing `delete only token`. In the test, create that baseline after `CreateFixtureRepo()` by writing `review.js`, then run:

```ts
Git(fixture.repoPath, ["add", "review.js"]);
Git(fixture.repoPath, ["commit", "-m", "Add review fixture"]);
```

Then overwrite `review.js` with the modified content shown above so the main worktree has unstaged pure insertion, pure deletion, and edit hunks.

- [ ] **Step 3: Assert the new real test fails for the current bug**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/integration/repoWorkspaceFlow.integration.test.js --test-name-pattern "hunk-aware source rendering preserves highlighting and Emacs navigation"
```

Expected now: FAIL because at least one of these is false:
- `.sheaf-chat-agent-review-inline .hljs` exists for `review.js`
- `.sheaf-chat-file-search-match` appears inside inserted/deleted/edit hunk text
- `.sheaf-chat-file-region` appears after mark movement across hunk text

- [ ] **Step 4: Commit failing tests**

```bash
git add projects/sheaf-chat/tests/ui/chatScreen.test.ts projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts
git commit -m "test: cover hunk-aware source rendering parity"
```

### Task 2: Add Shared Source Rendering Module

**Files:**
- Create: `projects/sheaf-chat/src/ui/sheaf-source-rendering.js`
- Modify: `projects/sheaf-chat/src/ui/index.html`
- Test: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`

- [ ] **Step 1: Create `sheaf-source-rendering.js` with render-document helpers**

Create `projects/sheaf-chat/src/ui/sheaf-source-rendering.js` with this public API:

```js
(function () {
  "use strict";

  function Text(value) {
    return String(value == null ? "" : value);
  }

  function BuildPlainDocument(path, content) {
    const text = Text(content);
    return {
      path: Text(path),
      text: text,
      segments: [{
        id: "source:0",
        kind: "source",
        text: text,
        start: 0,
        end: text.length,
        sourceStart: 0,
        sourceEnd: text.length,
      }],
    };
  }

  function BuildReviewDocument(path, inlineFile) {
    const rows = inlineFile && Array.isArray(inlineFile.rows) ? inlineFile.rows : [];
    const segments = [];
    let text = "";
    rows.forEach(function (row, index) {
      const rowText = Text(row && row.text);
      const prefix = index === 0 ? "" : "\n";
      if (prefix) {
        segments.push({ id: "separator:" + index, kind: "separator", text: prefix, start: text.length, end: text.length + prefix.length });
        text += prefix;
      }
      const start = text.length;
      text += rowText;
      segments.push({
        id: Text(row && row.id) || "row:" + index,
        kind: row && row.kind ? Text(row.kind) : "context",
        text: rowText,
        start: start,
        end: text.length,
        hunkId: typeof row.hunkId === "string" ? row.hunkId : null,
        oldLineNumber: row.oldLineNumber == null ? null : Number(row.oldLineNumber),
        newLineNumber: row.newLineNumber == null ? null : Number(row.newLineNumber),
        virtual: row && row.kind === "deletion",
      });
    });
    return { path: Text(path), text: text, segments: segments };
  }

  function SegmentForOffset(documentModel, offset) {
    const segments = documentModel && Array.isArray(documentModel.segments) ? documentModel.segments : [];
    return segments.find(function (segment) {
      return segment && offset >= segment.start && offset < segment.end;
    }) || segments[segments.length - 1] || null;
  }

  function Exported() {
    return {
      buildPlainDocument: BuildPlainDocument,
      buildReviewDocument: BuildReviewDocument,
      segmentForOffset: SegmentForOffset,
    };
  }

  window.SheafSourceRendering = Exported();
})();
```

- [ ] **Step 2: Load the module before navigation and chat app scripts**

In `projects/sheaf-chat/src/ui/index.html`, add:

```html
<script src="/assets/sheaf-chat/sheaf-source-rendering.js"></script>
```

Place it before:

```html
<script src="/assets/sheaf-chat/sheaf-file-navigation.js"></script>
```

- [ ] **Step 3: Add a fast smoke assertion for module availability**

In an existing UI harness setup test in `projects/sheaf-chat/tests/ui/chatScreen.test.ts`, assert:

```ts
assert.ok((globalThis as any).SheafSourceRendering || harness.context.SheafSourceRendering);
```

Use the test harness' actual script context object; if the harness does not expose it, assert behavior indirectly in the new hunk Highlight.js test from Task 1.

- [ ] **Step 4: Verify build and targeted UI test**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "Agent Review hunk-aware text files preserve Highlight.js token rendering"
```

Expected: still FAIL until rendering integration is done, but build must PASS.

- [ ] **Step 5: Commit module scaffold**

```bash
git add projects/sheaf-chat/src/ui/sheaf-source-rendering.js projects/sheaf-chat/src/ui/index.html projects/sheaf-chat/tests/ui/chatScreen.test.ts
git commit -m "feat: add shared file source rendering module"
```

### Task 3: Move Normal File Rendering Onto The Shared Document

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-source-rendering.js`
- Test: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`

- [ ] **Step 1: Extend source rendering with Highlight.js rendering**

In `sheaf-source-rendering.js`, add `renderCodeSegment(parent, segment, language, highlighter)` and `renderDocument(documentModel, options)`. The renderer must:
- create `.sheaf-chat-file-plain.sheaf-chat-file-highlighted` for highlighted normal files
- create `.sheaf-chat-agent-review-inline` for review documents
- put only addressable text inside elements with `data-render-segment-id`
- keep gutters/markers outside addressable text

Use this shape:

```js
function RenderHighlightedCode(text, language, highlighter) {
  if (!highlighter || typeof highlighter.highlight !== "function" || typeof highlighter.getLanguage !== "function" || !highlighter.getLanguage(language)) {
    return null;
  }
  try {
    return highlighter.highlight(Text(text), { language: language, ignoreIllegals: true }).value;
  } catch (_error) {
    return null;
  }
}
```

- [ ] **Step 2: Use `BuildPlainDocument` for text previews**

In `sheaf-chat.js`, replace direct text preview construction for non-Markdown text files with:

```js
const sourceRendering = window.SheafSourceRendering;
const documentModel = sourceRendering && sourceRendering.buildPlainDocument
  ? sourceRendering.buildPlainDocument(selected.path, selected.content)
  : null;
```

Keep `CreateHighlightedFilePreview()` as a fallback until the new path is passing, then remove dead fallback branches in Task 7.

- [ ] **Step 3: Teach navigation to read the render document**

In `sheaf-file-navigation.js`, add support for `tab.navigationDocumentText` or `tab.renderDocument.text`. `SelectedTabAndState()` must clamp point against the render-document text when present:

```js
function NavigationText(tab) {
  if (tab && tab.renderDocument && typeof tab.renderDocument.text === "string") {
    return tab.renderDocument.text;
  }
  return String(tab && tab.content != null ? tab.content : "");
}
```

Use `NavigationText(tab)` anywhere movement/search currently uses `tab.content`.

- [ ] **Step 4: Verify no-hunk tests still pass**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/integration/browserChat.integration.test.js --test-name-pattern "highlighted file navigation composes point, region, and search decorations"
```

Expected: PASS.

- [ ] **Step 5: Commit normal rendering migration**

```bash
git add projects/sheaf-chat/src/ui/sheaf-chat.js projects/sheaf-chat/src/ui/sheaf-file-navigation.js projects/sheaf-chat/src/ui/sheaf-source-rendering.js projects/sheaf-chat/tests/integration/browserChat.integration.test.ts
git commit -m "refactor: render normal text files through source documents"
```

### Task 4: Render Agent Review Hunks Through The Shared Source Document

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-source-rendering.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.css`
- Test: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`

- [ ] **Step 1: Replace `RenderInlineReviewFile` textContent source path**

In `sheaf-chat.js`, keep `RenderInlineReviewFile` as the Agent Review chrome entry point, but make it call:

```js
const documentModel = window.SheafSourceRendering.buildReviewDocument(selected.path, inlineFile);
selected.renderDocument = documentModel;
selected.navigationDocumentText = documentModel.text;
```

The DOM rows must still use:
- `.sheaf-chat-agent-review-inline-row`
- `.sheaf-chat-agent-review-inline-row--addition`
- `.sheaf-chat-agent-review-inline-row--deletion`
- `.sheaf-chat-agent-review-inline-row--focused`
- `.sheaf-chat-agent-review-inline-row--muted`
- `.sheaf-chat-agent-review-inline-hunk-anchor`
- `.sheaf-chat-agent-review-inline-code`

- [ ] **Step 2: Remove review-special point-only decoration**

In `sheaf-file-navigation.js`, change `DecorateRenderedReview()` so it calls the same document decoration path as normal highlighted previews. Delete the branch where focused rows only call `DecorateReviewFocusedPoint(focusedRow)`. Keep hunk focus anchoring by setting `state.point` to the focused row segment start when `state.reviewFocusKey` changes.

- [ ] **Step 3: Make search and mark wrap inside code cells only**

In `sheaf-source-rendering.js`, expose a decoration function that maps render-document ranges to elements with `data-render-start` and `data-render-end`. It must not wrap marker or line-number gutter text. Required attributes on code spans:

```html
<span class="sheaf-chat-agent-review-inline-code" data-render-segment-id="..." data-render-start="..." data-render-end="..."></span>
```

- [ ] **Step 4: Preserve hunk comments and anchors**

Keep comment insertion after the focused hunk end by row/hunk metadata, not by rendered text offsets. `ShouldShowReviewCommentBox(currentHunk.hunkId)` behavior must remain unchanged.

- [ ] **Step 5: Verify mocked hunk Highlight.js test passes**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "Agent Review hunk-aware text files preserve Highlight.js token rendering"
```

Expected: PASS.

- [ ] **Step 6: Commit hunk rendering migration**

```bash
git add projects/sheaf-chat/src/ui/sheaf-chat.js projects/sheaf-chat/src/ui/sheaf-file-navigation.js projects/sheaf-chat/src/ui/sheaf-source-rendering.js projects/sheaf-chat/src/ui/sheaf-chat.css projects/sheaf-chat/tests/ui/chatScreen.test.ts
git commit -m "refactor: render agent review hunks through source documents"
```

### Task 5: Complete Real Git Hunk Navigation/Search/Mark Coverage

**Files:**
- Modify: `projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts`
- Read first, modify only when repeated row text makes browser-side mapping nondeterministic: `projects/sheaf-chat/src/server/agentReview/git.ts`
- Read first, modify only when repeated row text makes browser-side mapping nondeterministic: `projects/sheaf-chat/src/server/agentReview/types.ts`

- [ ] **Step 1: Finish the real Chromium hunk test**

The test from Task 1 must assert all of these:

```ts
await page.locator(".sheaf-chat-agent-review-inline .hljs").waitFor({ timeout: 5000 });
await fileView.press("Control+S");
await fileView.press("i");
await fileView.press("n");
await fileView.press("s");
await page.locator(".sheaf-chat-agent-review-inline-row--addition .sheaf-chat-file-search-match").waitFor({ timeout: 5000 });
await fileView.press("Control+G");
await fileView.press("Control+S");
await fileView.press("d");
await fileView.press("e");
await fileView.press("l");
await page.locator(".sheaf-chat-agent-review-inline-row--deletion .sheaf-chat-file-search-match").waitFor({ timeout: 5000 });
await fileView.press("Control+G");
await fileView.press("Control+Space");
await fileView.press("ArrowRight");
await fileView.press("ArrowRight");
assert.ok(await page.locator(".sheaf-chat-agent-review-inline-code .sheaf-chat-file-region").count() >= 1);
```

- [ ] **Step 2: Add pure insertion, pure deletion, and edit assertions**

Assert these selectors or equivalent text-bearing row checks:

```ts
assert.equal(await page.locator(".sheaf-chat-agent-review-inline-row--addition", { hasText: "insert only token" }).count(), 1);
assert.equal(await page.locator(".sheaf-chat-agent-review-inline-row--deletion", { hasText: "delete only token" }).count(), 1);
assert.equal(await page.locator(".sheaf-chat-agent-review-inline-row--deletion", { hasText: "old edit token" }).count(), 1);
assert.equal(await page.locator(".sheaf-chat-agent-review-inline-row--addition", { hasText: "new edit token" }).count(), 1);
```

- [ ] **Step 3: Extend server metadata only if browser mapping is nondeterministic**

If repeated row text makes browser-side mapping ambiguous, add optional fields to `AgentReviewInlineRow`:

```ts
renderTextStart?: number;
renderTextEnd?: number;
virtual?: boolean;
```

Populate them in `BuildInlineFiles()` in `projects/sheaf-chat/src/server/agentReview/git.ts`. Do not change existing fields or route names.

- [ ] **Step 4: Run real integration test**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/integration/repoWorkspaceFlow.integration.test.js --test-name-pattern "hunk-aware source rendering preserves highlighting and Emacs navigation"
```

Expected: PASS.

- [ ] **Step 5: Commit coverage and any metadata changes**

```bash
git add projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts projects/sheaf-chat/src/server/agentReview/git.ts projects/sheaf-chat/src/server/agentReview/types.ts
git commit -m "test: verify emacs navigation on hunk virtual text"
```

### Task 6: Preserve Existing Agent Review Behavior

**Files:**
- Modify: `projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts`
- Modify: `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`

- [ ] **Step 1: Re-run existing review navigation assertions**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/integration/repoWorkspaceFlow.integration.test.js --test-name-pattern "front door Agent Review renders inline diffs and stages focused hunks in Chromium"
```

Expected: PASS, including focused rows, point inside focused hunk, staging, and no page errors.

- [ ] **Step 2: Add hunk-focus survival assertion after search**

In the front-door test, after opening `notes.md`, add:

```ts
await fileView.press("Control+S");
await fileView.press("a");
await fileView.press("l");
await fileView.press("t");
await fileView.press("Enter");
assert.equal(
  await page.locator(".sheaf-chat-agent-review-inline-row--focused").count() > 0,
  true,
  "review hunk focus should survive accepted file-view search",
);
```

- [ ] **Step 3: Verify no regression in mocked Agent Review UI tests**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "Agent Review"
```

Expected: PASS for Agent Review UI tests.

- [ ] **Step 4: Commit behavior preservation tests/fixes**

```bash
git add projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts projects/sheaf-chat/tests/ui/chatScreen.test.ts projects/sheaf-chat/src/ui/sheaf-chat.js projects/sheaf-chat/src/ui/sheaf-file-navigation.js
git commit -m "test: preserve agent review behavior after source rendering unification"
```

### Task 7: Remove Dead Split Rendering Paths And Validate Text Stability

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-source-rendering.js`
- Modify: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`
- Modify: `projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts`

- [ ] **Step 1: Remove fallback hunk-only source rendering**

Remove or reduce these old split behaviors:
- `RenderInlineReviewFile()` directly setting `.sheaf-chat-agent-review-inline-code.textContent` as the only source-rendering path
- `DecorateReviewFocusedPoint()` inserting only a point at offset `0`
- `DecorateRenderedReview()` skipping normal region/search wrapping when a focused row exists

- [ ] **Step 2: Add textContent stability assertions**

For no-hunk highlighted files and hunk-bearing review files, assert that visible code text remains stable after point, region, and search decoration. Use this check:

```ts
const beforeText = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-code"))
    .map((node) => node.textContent ?? "")
    .join("\n")
);
await fileView.press("Control+S");
await fileView.press("t");
await fileView.press("o");
await fileView.press("k");
const afterText = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".sheaf-chat-agent-review-inline-code"))
    .map((node) => node.textContent ?? "")
    .join("\n")
);
assert.equal(afterText, beforeText);
```

- [ ] **Step 3: Run targeted stability tests**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/integration/browserChat.integration.test.js --test-name-pattern "rendered file point does not inject blank text into previews|highlighted file navigation composes point, region, and search decorations"
node --test dist/tests/integration/repoWorkspaceFlow.integration.test.js --test-name-pattern "hunk-aware source rendering preserves highlighting and Emacs navigation"
```

Expected: PASS.

- [ ] **Step 4: Commit split-path cleanup**

```bash
git add projects/sheaf-chat/src/ui/sheaf-chat.js projects/sheaf-chat/src/ui/sheaf-file-navigation.js projects/sheaf-chat/src/ui/sheaf-source-rendering.js projects/sheaf-chat/tests/integration/browserChat.integration.test.ts projects/sheaf-chat/tests/integration/repoWorkspaceFlow.integration.test.ts
git commit -m "refactor: remove split hunk source rendering path"
```

### Task 8: Full Validation And OpenSpec Synchronization

**Files:**
- Modify: `openspec/changes/unify-agent-review-source-rendering/tasks.md`
- Modify: `projects/sheaf-chat/docs/coverage.md`
- Read: `openspec/changes/unify-agent-review-source-rendering/specs/sheaf-chat-file-browser/spec.md`
- Read: `openspec/changes/unify-agent-review-source-rendering/specs/sheaf-chat-agent-review-mode/spec.md`

- [ ] **Step 1: Run targeted suites**

Run:

```bash
cd projects/sheaf-chat
npm run build
node --test dist/tests/ui/chatScreen.test.js --test-name-pattern "Agent Review|Highlight|highlight|Emacs|search|mark"
node --test dist/tests/integration/browserChat.integration.test.js --test-name-pattern "file view|highlighted|search|mark|navigation"
node --test dist/tests/integration/repoWorkspaceFlow.integration.test.js --test-name-pattern "Agent Review|hunk-aware source rendering"
```

Expected: PASS.

- [ ] **Step 2: Run full Sheaf Chat test suite**

Run:

```bash
cd projects/sheaf-chat
npm test
```

Expected: PASS. If Playwright/browser dependencies are missing, run `npm run build`, run all non-browser tests available through `node scripts/run-tests.mjs`, record the exact failing environment message in the final implementation notes, and do not mark OpenSpec validation tasks complete until the browser coverage has run somewhere.

- [ ] **Step 3: Perform split-path source audit**

Run:

```bash
rg -n "RenderInlineReviewFile|DecorateRenderedReview|DecorateReviewFocusedPoint|CreateHighlightedFilePreview|sheaf-chat-agent-review-inline-code|textContent = row\\.text|file-search-match|file-region" projects/sheaf-chat/src/ui
```

Expected:
- Any remaining Agent Review-specific functions only add review chrome or focus anchors.
- No remaining code path bypasses shared source rendering for syntax highlighting, point, region, or search.

- [ ] **Step 4: Perform coverage matrix audit**

Create or update a short section in `projects/sheaf-chat/docs/coverage.md` with this matrix if the file already tracks Sheaf Chat coverage. If it does not, include the matrix in the final implementation notes instead:

```markdown
### Unified Source Rendering Coverage

| Scenario | No-hunk test | Hunk-bearing test |
|---|---|---|
| Syntax highlighting | browserChat highlighted navigation | repoWorkspace hunk-aware source rendering |
| Point movement | browserChat file view navigation | repoWorkspace hunk-aware source rendering |
| Mark/region | browserChat mark tests | repoWorkspace hunk-aware source rendering |
| Incremental search | browserChat search tests | repoWorkspace hunk-aware source rendering |
| Pure insertion | n/a | repoWorkspace hunk-aware source rendering |
| Pure deletion | n/a | repoWorkspace hunk-aware source rendering |
| Edit replacement | n/a | repoWorkspace hunk-aware source rendering |
```

- [ ] **Step 5: Update OpenSpec tasks**

After code review and verification pass, mark completed boxes in:

```text
openspec/changes/unify-agent-review-source-rendering/tasks.md
```

Use the mapping:
- OpenSpec 1.1-1.6: Tasks 1, 5, 6, 7
- OpenSpec 2.1-2.4: Tasks 2, 3, 4, 5
- OpenSpec 3.1-3.5: Tasks 3, 4, 7
- OpenSpec 4.1-4.4: Task 6
- OpenSpec 5.1-5.3: Task 8 steps 1-2
- OpenSpec 6.1-6.2: Task 8 steps 3-4

- [ ] **Step 6: Commit validation and OpenSpec progress**

```bash
git add openspec/changes/unify-agent-review-source-rendering/tasks.md projects/sheaf-chat/docs/coverage.md
git commit -m "docs: record unified source rendering coverage"
```

## Self-Review

- Spec coverage: `fb-29` is covered by Tasks 1, 3, 4, 6, 7, 8. `fb-38` is covered by Tasks 1, 4, 5, 7. `arm-23` is covered by Tasks 4, 6, 7. `arm-24` is covered by Tasks 4 and 5.
- Placeholder scan: no `TBD`, `TODO`, or unspecified edge-case tasks remain.
- Type consistency: the planned browser API is `window.SheafSourceRendering` with `buildPlainDocument`, `buildReviewDocument`, and `segmentForOffset`; later tasks consistently refer to `renderDocument`, `tab.renderDocument`, and `tab.navigationDocumentText` as implementation extensions.
