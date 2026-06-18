# Emacs Navigation File View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only Emacs-style point, mark, search, find-file, and buffer/tab navigation to the Sheaf Chat file viewer while preserving Markdown, Agent Review, and existing chat behavior.

**Architecture:** Add a focused browser module, `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`, that owns source-offset navigation state, command dispatch, prompt state, rendering decorations, and deterministic simulation helpers. Wire that module into `CreateFileWorkspace` in `projects/sheaf-chat/src/ui/sheaf-chat.js`, with minimal integration hooks for tabs, content rendering, directory loading, and tab selection.

**Tech Stack:** Browser JavaScript, Sheaf Chat static UI, CSS, Node test runner, Playwright integration tests.

---

## Context

OpenSpec change: `openspec/changes/add-emacs-navigation-to-file-view`.

Primary requirements:
- `fb-30`: visible read-only point, arrows, mouse click, `C-a`, `C-e`, `C-v`, `M-v`, source-backed Markdown navigation with best-effort DOM projection and persistence.
- `fb-31`: `C-g` cancellation for key prefixes, prompts, and incremental search.
- `fb-32`: mark, active region, and `C-x C-x`.
- `fb-33` and `fb-34`: incremental search plus search-origin mark interaction.
- `fb-35`: `C-x C-f` find-file prompt with directory completion, safe path handling, and existing tab open/focus behavior.
- `fb-36`: `C-x b` tab-switch prompt over existing tabs.
- Tests must include deterministic Playwright simulation and Agent Review compatibility.

## File Structure

- Create `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`: navigation model, command dispatcher, rendering helpers, prompt rendering, simulation helpers.
- Modify `projects/sheaf-chat/src/ui/index.html`: load `sheaf-file-navigation.js` before `sheaf-chat.js`.
- Modify `projects/sheaf-chat/src/ui/sheaf-chat.js`: instantiate navigation controller in `CreateFileWorkspace`, expose tab/directory/open-file hooks, wrap rendered file content with navigation data, persist navigation state in editor state.
- Modify `projects/sheaf-chat/src/ui/sheaf-chat.css`: point, region, search, prompt, focus, and completion styling.
- Modify `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`: Playwright integration tests for Emacs navigation, Markdown projection, prompts, simulation, and Agent Review compatibility.
- Modify `projects/sheaf-chat/docs/coverage.md`: document the navigation coverage.
- Modify `openspec/changes/add-emacs-navigation-to-file-view/tasks.md`: mark tasks complete only after implementation and verification.

## Task 1: Navigation Model And Static Loading

**Files:**
- Create: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/index.html`
- Test: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`

- [ ] **Step 1: Write failing Playwright smoke test**

Add a test that opens a text file, waits for `window.SheafFileNavigation`, focuses `.sheaf-chat-file-view`, and asserts `.sheaf-chat-file-point` exists. Run:

```bash
cd projects/sheaf-chat && npm run build && node --test dist/tests/integration/browserChat.integration.test.js --test-name-pattern "file view shows an Emacs point"
```

Expected: FAIL because `window.SheafFileNavigation` or `.sheaf-chat-file-point` does not exist.

- [ ] **Step 2: Create the module**

Implement `window.SheafFileNavigation` with:
- `createController(config)`
- source helpers: `clampOffset`, `lineStarts`, `lineBounds`, `moveOffset`
- `renderDecoratedPlainText(content, state)` returning DOM nodes with `.sheaf-chat-file-point`, `.sheaf-chat-file-region`, `.sheaf-chat-file-search-match`
- command methods for initial no-op-safe `focusSelectedTab`, `syncSelectedTab`, and `destroy`

- [ ] **Step 3: Load the module**

Insert this script before `sheaf-chat.js` in `index.html`:

```html
<script src="/assets/sheaf-chat/sheaf-file-navigation.js"></script>
```

- [ ] **Step 4: Wire controller minimally**

In `CreateFileWorkspace`, create a navigation controller if `window.SheafFileNavigation.createController` exists. Make `fileViewEl` focusable with `tabIndex = 0`, `role = "region"`, and an accessible label. During `RenderSelectedFile`, ask the controller to decorate plain text content.

- [ ] **Step 5: Verify green**

Run the targeted Playwright test. Expected: PASS.

## Task 2: Point Movement And Markdown Source Mapping

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Test: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`

- [ ] **Step 1: Write failing movement tests**

Add Playwright assertions for `ArrowRight`, `ArrowLeft`, `ArrowDown`, `ArrowUp`, `C-a`, `C-e`, `C-v`, `M-v`, and mouse click. Tests should inspect `data-point-offset` on `.sheaf-chat-file-view`.

- [ ] **Step 2: Implement source-offset movement**

Add keydown handling scoped to file view focus. Maintain per-tab navigation state: `point`, `mark`, `markActive`, `desiredColumn`, `lastSearch`, `prefix`, `prompt`, and `selectedOrder`. Arrow and line/page commands update source offsets only.

- [ ] **Step 3: Implement Markdown projection**

For Markdown tabs, compute movement against raw Markdown source. Add deterministic `data-source-start` / `data-source-end` spans for a source-text fallback inside the rendered file content when exact Markdown DOM mapping is unavailable. Preserve rendered Markdown for normal reading and place point at the closest projected node.

- [ ] **Step 4: Persist best-effort navigation state**

Extend editor state payload with per-tab navigation state containing source offset, line, column, and a surrounding text anchor. Restore near the prior logical source position on tab switch, refresh, or editor state load.

- [ ] **Step 5: Verify**

Run targeted movement and Markdown tests. Expected: PASS.

## Task 3: `C-g`, Prefix Dispatch, Mark, And Region

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.css`
- Test: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `C-g` canceling a pending `C-x`, `C-SPC` activating mark, movement rendering `.sheaf-chat-file-region`, and `C-x C-x` exchanging point and mark including inactive mark behavior.

- [ ] **Step 2: Implement key prefix dispatcher**

Implement `C-x` prefix state, `C-g` cancellation, and claimed-key default prevention. Leave unclaimed keys and chat composer input untouched.

- [ ] **Step 3: Implement mark and region**

Implement `C-SPC`, active region state, inactive mark, and `C-x C-x`. Render region spans from source offsets.

- [ ] **Step 4: Style point and region**

Add CSS for visible point, active region, file-view focus, and accessible high-contrast defaults.

- [ ] **Step 5: Verify**

Run targeted `C-g` and mark tests. Expected: PASS.

## Task 4: Minibuffer Prompt And Incremental Search

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.css`
- Test: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `C-s`, `C-r`, typed query update, repeat search, direction switch, `RET` accept, `C-g` cancel, movement exiting search, and accepted search origin exchange.

- [ ] **Step 2: Implement shared prompt shell**

Render `.sheaf-chat-file-minibuffer` with command label, query, status, candidates, and errors. Prompt owns printable text, `Backspace`, `Tab`, `Enter`, and `C-g`.

- [ ] **Step 3: Implement incremental search**

Search source text forward and backward, wrap deterministically, highlight current match, update point immediately, and preserve or restore mark/search-origin state according to `fb-33` and `fb-34`.

- [ ] **Step 4: Verify**

Run targeted search tests. Expected: PASS.

## Task 5: Find-File And Buffer/Tab Switching

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Test: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Add tests for `C-x C-f` default directory, `TAB` completion, directory descent, safe file open/focus, unsafe path rejection, `C-x b` completion, existing-tab selection, empty-input previous-tab selection, and nonexistent-buffer rejection.

- [ ] **Step 2: Add directory and tab prompt hooks**

Expose from `CreateFileWorkspace`: selected path, tab list, directory cache, `loadDirectory`, `openFile`, and `selectTab`. Do not add server APIs.

- [ ] **Step 3: Implement find-file**

Use current file directory as default, complete one path segment at a time from existing directory listing, reject absolute paths, parent traversal, NUL, and unsupported entries, and reuse `OpenFile`.

- [ ] **Step 4: Implement buffer/tab switch**

Complete by name or path over open tabs, select accepted existing tab, use empty input to select most recently selected non-current tab, and reject nonexistent buffers.

- [ ] **Step 5: Verify**

Run targeted prompt tests. Expected: PASS.

## Task 6: Agent Review Compatibility And Deterministic Simulation

**Files:**
- Modify: `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`
- Modify: `projects/sheaf-chat/src/ui/sheaf-chat.js`
- Modify: `projects/sheaf-chat/tests/integration/browserChat.integration.test.ts`

- [ ] **Step 1: Write failing compatibility tests**

Add Playwright tests proving Emacs navigation does not break Agent Review hunk controls, inline diff rendering, comment focus, chat composer input, stale-tab refresh, tabs, and Markdown links.

- [ ] **Step 2: Add deterministic simulation helper**

Expose a test-only helper on `window.SheafFileNavigation` or the controller that can run a seeded command sequence against the same source-offset model used by UI commands and report expected versus observed point, mark, prompt, search, selected tab, and read-only state.

- [ ] **Step 3: Add randomized simulation tests**

Run several deterministic seeds across mixed commands: arrows, `C-a`, `C-e`, `C-v`, `M-v`, `C-g`, mark, exchange, search, find-file, and tab switching. Compare DOM-observed state with the model after every command.

- [ ] **Step 4: Verify**

Run targeted compatibility and simulation tests. Expected: PASS.

## Task 7: Documentation, OpenSpec Sync, And Full Verification

**Files:**
- Modify: `projects/sheaf-chat/docs/coverage.md`
- Modify: `openspec/changes/add-emacs-navigation-to-file-view/tasks.md`

- [ ] **Step 1: Update coverage docs**

Document that Sheaf Chat has Playwright coverage for read-only Emacs navigation, Markdown source-backed mapping, prompts, randomized simulation, and Agent Review compatibility.

- [ ] **Step 2: Mark OpenSpec tasks complete**

Mark each task checkbox in `openspec/changes/add-emacs-navigation-to-file-view/tasks.md` complete only after the implementation and tests satisfy the task.

- [ ] **Step 3: Run full verification**

Run:

```bash
cd projects/sheaf-chat && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Final self-review**

Review the diff for accidental editing behavior, server API changes, global keyboard capture, and unrelated churn.
