## Context

Agent Review Mode already has a solid command and state foundation:

- `projects/sheaf-chat/src/server/agentReview/git.ts` resolves Git availability, parses `git diff --unified=3`, builds ordered unstaged hunk snapshots, and applies validated hunk patches for stage/revert/undo.
- `projects/sheaf-chat/src/server/agentReview/types.ts` exposes `AgentReviewState`, `AgentReviewHunk`, file summaries, actions, and review draft entries over the dedicated Agent Review WebSocket.
- `projects/sheaf-chat/src/ui/sheaf-chat.js` opens the current hunk file when Agent Review state changes, but it currently renders the focused hunk as a separate patch panel above the normal file preview.
- The file preview path already supports plain text and highlight.js-backed syntax highlighting for normal file content.

The requested UX needs the browser to review a processed file representation instead of raw disk content alone. That representation must include deleted old lines, added new lines, stable hunk anchors, focus state, and comment insertion points. Git remains the source of truth for what is unstaged and what has been staged.

## Goals / Non-Goals

**Goals:**

- Render Agent Review files as inline diff documents while review mode is active.
- Show every unstaged change in the selected file, not just the focused hunk.
- Distinguish focused hunk additions/deletions from non-focused additions/deletions with brighter and duller green/red treatments.
- Keep unchanged code visible and scrollable in natural file order.
- Place the review comment text box adjacent to the focused hunk's inline rows.
- Scroll the file viewer to the selected hunk after previous/next hunk and previous/next file navigation only when the target hunk is not already fully visible, positioning the hunk near the top with a small preceding context offset rather than centering it.
- Ensure accepted/staged hunks disappear from the unstaged inline diff and appear as normal file content after state recomputation.
- Preserve existing Agent Review command semantics, Dictator bridge behavior, and Git safety guarantees.

**Non-Goals:**

- Emulate Cursor's diff UI exactly.
- Add side-by-side diff viewing.
- Render inline word-level diffs within a changed line.
- Display binary files or unsupported Git diffs in Agent Review.
- Change the stage/revert/undo Git mutation behavior.
- Persist Agent Review inline documents in chat history.

## Decisions

### Decision 1: Produce inline review documents on the server

The Sheaf Chat service should extend `AgentReviewState` with a file-scoped inline review document for each file that has unstaged hunks. The browser should render that document when Agent Review is active and the selected tab path matches a review file.

The document should contain rows like:

```ts
interface AgentReviewInlineFile
{
  file: string;
  rows: AgentReviewInlineRow[];
}

type AgentReviewInlineRowKind = "context" | "addition" | "deletion";

interface AgentReviewInlineRow
{
  id: string;
  kind: AgentReviewInlineRowKind;
  text: string;
  hunkId?: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}
```

Rationale:

- The server already computes authoritative Git state and has access to both diff metadata and file content.
- The browser should not need to shell out, fetch historical file versions, or reconstruct deleted lines from raw disk content.
- A server-owned model keeps WebSocket bootstrap/state frames sufficient for rendering, scrolling, and comment placement.

Alternative considered: Build inline rows entirely in the browser from each hunk's `patch` field and selected file content. That would work for basic cases, but it duplicates diff parsing in the UI and makes old-line reconstruction and stale-state handling harder to test.

### Decision 2: Build rows from Git's unified diff plus current file content

Use Git as the diff algorithm. Continue using validated hunk patches for mutation, but add a dedicated inline view builder that consumes Git diff hunks and the current worktree file content.

The builder should:

1. Parse each file diff into hunk sections with old/new ranges.
2. Walk the current worktree file lines using the new-file line numbers.
3. Emit unchanged `context` rows between hunks from current file content.
4. Emit `deletion` rows from `-` diff lines with old line numbers and no new line number.
5. Emit `addition` rows from `+` diff lines with new line numbers.
6. Emit diff context rows inside hunks as `context` rows with both old and new line numbers.
7. Associate every changed and hunk-context row inside a hunk with that hunk's stable `hunkId`.

Use `git diff --no-ext-diff --unified=3` for the command hunk patch, and either reuse that parsed diff for the inline document or run a second `--unified=0` diff if implementation proves simpler. The preferred implementation is to enhance the existing parser once and avoid extra Git calls.

Rationale:

- Git already handles rename headers, line ranges, and patch format consistently with stage/revert commands.
- After staging a hunk, recomputing the unstaged diff naturally removes that hunk from the inline review document while the current worktree file content still contains the accepted code as normal rows.
- A custom row builder is narrow and testable, so it is preferable to introducing a broad dependency unless a small parser clearly reduces complexity.

Alternative considered: Add a generic JavaScript diff library and compare HEAD content to worktree content. That would require fetching HEAD blobs, reimplement hunk identity mapping, and risk disagreement with the Git patches used for staging. It is useful only if a package is selected strictly as a unified-diff parser, not as an independent diff source.

### Decision 3: Keep hunk identity anchored to existing `AgentReviewHunk`

Inline rows should refer to existing `hunkId` values. The current `AgentReviewHunk` model remains the command target and review-draft identity. New inline file rows add visual placement data, not a second hunk model.

Rationale:

- Review comments, dictation context, stage/revert, and undo already key off `hunkId` plus `patchHash`.
- Reusing hunk identity prevents drift between controls and rendering.

### Decision 4: Render a dedicated review code view instead of modifying raw highlighted HTML

When Agent Review Mode is active and the selected file has an inline review document, `RenderSelectedFile` should bypass the normal markdown/highlighted/plain preview path and render a review-specific code view:

- One row element per inline row.
- Stable `data-review-row-id` and `data-hunk-id` attributes.
- CSS classes for row kind and focus state.
- A hunk container or marker at the first row for each hunk.
- The comment text box mounted next to the focused hunk's inline block when visible.

The review code view may use plain text rows initially. Syntax-highlighted inline rows can be added later if needed, but the first implementation should prioritize correct diff layout, scroll anchoring, and comment ergonomics.

Rationale:

- highlight.js returns an HTML string for a whole file, which is awkward to splice with deleted rows that do not exist in the current file.
- Rendering text content per row avoids unsafe HTML mixing and makes line-based styling reliable.

Alternative considered: Highlight each row independently. That keeps some colorization but often produces inconsistent token context across multiline syntax. It can be evaluated after the layout is correct.

### Decision 5: Scroll after render using the focused hunk anchor

`ApplyReviewState` already opens the current file when focus changes. After the selected file is loaded and rendered, the UI should locate the focused hunk's changed rows. If all added/deleted rows for the focused hunk are already fully visible in the file viewport, the UI should leave `scrollTop` unchanged and only update the focus styling. Otherwise, it should scroll the file viewport so the focused hunk's first changed row appears near the top with roughly two inline rows of context above it. Use a pending scroll target in `state.agentReview` so the visibility check and any scroll happen after asynchronous `OpenFile` and DOM rendering complete.

Rationale:

- Navigation commands already flow through server state, so the UI can treat the current hunk as the source of truth.
- A top-biased placement keeps upcoming changed lines visible and avoids making the focused hunk feel too low in the review viewport.
- Skipping scroll when the target hunk is already on screen avoids disorienting view jumps during local hunk-by-hunk review.
- Deferring scroll until after render avoids racing file loads.

### Decision 6: Keep comment lifecycle semantics, move placement

The existing comment visibility rules should remain: comments appear only for the focused hunk when the hunk already has a comment/draft or the user requests the comment box. The difference is placement: the textarea should be inserted adjacent to the focused hunk's inline rows instead of inside a separate top patch panel.

Rationale:

- This preserves Launchpad review cell behavior and dictation context behavior.
- It makes the comment feel attached to the code under review.

## Risks / Trade-offs

- Inline document payloads can be larger than current hunk-only state -> Mitigation: include inline documents only for files with review hunks, skip unsupported/binary diffs, and keep rows compact.
- Large files with small diffs may still produce many context rows -> Mitigation: initially prefer correctness, then add viewport virtualization or collapsed unchanged ranges only if performance data demands it.
- Git diff parsing edge cases can desynchronize rows and hunk commands -> Mitigation: centralize parsing in `git.ts`, test multiline hunks, multiple hunks in one file, additions-only, deletions-only, and stage/recompute flows.
- Plain review rows lose syntax highlighting during review -> Mitigation: accept this as a first-step trade-off; the red/green inline review treatment is more important than token coloring for this change.
- Comment focus can race with hunk navigation -> Mitigation: continue sending `comment_focus`/`comment_blur` frames from the mounted textarea and pop dictation context when the focused hunk changes or the textarea unmounts.

## Migration Plan

1. Extend TypeScript types and server state generation behind the existing Agent Review WebSocket frames.
2. Add tests for the inline document builder without changing command behavior.
3. Replace the browser's separate hunk patch panel with the inline review view when review rows exist.
4. Keep the normal file preview path for non-review mode and for review files with unsupported inline documents.
5. Verify staging/reverting recomputes state so staged hunks are rendered as normal content and reverted hunks disappear from the worktree.

Rollback is straightforward: remove the inline document fields from rendering and return to the existing hunk patch panel, since Git mutation APIs and command frames remain unchanged.

## Open Questions

- Should the first implementation include line numbers in the UI, or only keep line numbers in the row model for anchors and tests?
- Should unchanged regions far away from hunks be fully expanded at launch, or should very large files gain collapsed context blocks after the baseline behavior is working?
- Is plain text acceptable during review mode for the first implementation, or should row-level syntax highlighting be included immediately?
