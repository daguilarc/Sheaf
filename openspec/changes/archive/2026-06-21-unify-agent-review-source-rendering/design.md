## Context

Sheaf Chat's file viewer now serves both normal file browsing and Agent Review. Ordinary files flow through Markdown, syntax-highlighted text, or plain-text preview paths, then Emacs-style point, mark, region, search, and minibuffer decorations are projected onto the rendered source. Files with Agent Review hunks currently take a separate inline review path that builds diff rows directly and inserts a special review point. That separate path lost Highlight.js token rendering and does not apply the normal search/mark decoration model.

The desired model is that a hunk-bearing file is the same source presentation plus hunk overlays. A file with no hunks is the zero-hunk case. The only extra text in the hunk case is virtual diff text: deleted old lines and any added/deleted line variants needed to show an edit. From Emacs navigation's point of view, that virtual diff text is still text and must be addressable.

## Goals / Non-Goals

**Goals:**

- Use one source-backed rendering/decorating pipeline for normal files and hunk-bearing Agent Review files.
- Preserve syntax highlighting for supported text files with and without hunks.
- Make point, mark, active region, incremental search, search-origin mark behavior, mark exchange, minibuffer state, and viewport synchronization work in hunk views the same way they work in normal previews.
- Treat addition and deletion rows, including pure insertions, pure deletions, and edits, as addressable text for navigation and search.
- Preserve Agent Review-specific row treatments, focused-hunk emphasis, hunk anchors, comment boxes, stage/revert/undo controls, and Launchpad behavior.
- Add tests that prove the no-hunk Emacs and syntax-highlighting scenarios also pass with hunk overlays.

**Non-Goals:**

- Changing Git hunk mutation semantics, patch hashing, stage/revert/undo behavior, or Launchpad command mapping.
- Adding write/edit commands to the file viewer's Emacs navigation layer.
- Changing public REST route names or WebSocket route names.
- Making Markdown-rendered prose map perfectly through every Markdown transform; existing source-offset best-effort behavior remains acceptable for Markdown.

## Decisions

### Decision 1: Represent hunk views as source segments with overlays

The viewer should construct a normalized render document made of ordered text segments. Normal files produce only source segments. Agent Review files add hunk metadata and virtual diff segments for deletion/addition variants. Each segment carries enough metadata to map source-render offsets back to row identity, hunk identity, source range, virtual range, and line numbers.

Rationale: the core bug is that Agent Review became an alternate renderer. A segment model lets syntax highlighting, point, region, and search operate over one document while hunk UI remains an annotation layer.

Alternative considered: keep the inline row DOM and patch individual decorators. That would fix today's search symptom but preserves the split that caused the regression and would keep producing special cases for mark, search, highlighting, and viewport sync.

### Decision 2: Give virtual diff text explicit address ranges

The Emacs navigation document for a hunk view should include unchanged context text, addition text, deletion text, and edit-side variants in displayed order. Pure insertions, pure deletions, and replacements therefore all expose selectable/searchable ranges. These ranges are separate from the current worktree file offset when necessary, because deleted old text has no current-file offset.

Rationale: the user-visible review view contains red/green text. If the user can see that text, point/mark/search should address it consistently.

Alternative considered: restrict Emacs navigation to current worktree source offsets only. That would keep source offsets simple but would make deleted lines unsearchable and would violate the "red/green virtual hunk text is text" requirement.

### Decision 3: Apply highlighting before navigation decorations within each code text segment

For supported languages, the renderer should highlight each code text segment using the same language mapping as normal previews, then project point, region, and search spans across the highlighted text nodes. Diff markers and line numbers are UI chrome, not part of the searchable text document.

Rationale: Highlight.js returns markup, and navigation decorations already know how to wrap rendered text nodes. Treating each segment's code text as the only text content avoids offset drift from diff markers and line numbers.

Alternative considered: highlight the entire flattened diff view including markers and line numbers. That would be easier to render but would pollute search/navigation offsets and could produce misleading syntax classes on review chrome.

### Decision 4: Test parity through shared scenario helpers

Existing no-hunk Emacs and highlighting tests should be converted or supplemented with helpers that run against both a normal file and a hunk-bearing version of the same file. Agent Review-specific tests should assert the extra hunk affordances separately.

Rationale: the regression escaped because tests covered normal highlighting/search and hunk rendering in isolation. A parity harness makes the expected relationship explicit.

Alternative considered: add a few isolated regression tests. That is useful but insufficient; it would not catch future drift between normal and hunk paths.

## Risks / Trade-offs

- Hunk render document offsets become more complex because deleted text is not in the current worktree file. -> Keep current-file offsets for source persistence, add explicit render-document offsets for visible virtual text, and test both pure deletion and edit cases.
- Per-row Highlight.js calls could be slower on large files. -> Cache highlighted segment output by file path, content version, language, row text, and hunk state where practical; keep tests focused on correctness first.
- Wrapping navigation spans through highlighted markup can disturb DOM structure. -> Reuse the existing rendered-source decoration strategy and add tests that textContent remains stable after point, region, and search decorations.
- Markdown hunk views may be ambiguous because normal Markdown uses rendered prose while Agent Review rows are code-like line text. -> Treat Agent Review inline diff rows as code/text review rows for hunk overlay behavior; do not attempt to render Markdown prose inside hunk rows.
- A partial implementation could leave a hidden split path. -> End implementation with a test/coverage and source audit task that explicitly searches for separate hunk-only rendering/decorating behavior.

## Migration Plan

1. Add failing parity tests for syntax highlighting and Emacs navigation/search/mark behavior in hunk-bearing files.
2. Introduce the shared render-document/segment representation behind the existing UI entry points.
3. Move normal previews and Agent Review inline previews onto the shared render/decorate pipeline.
4. Preserve Agent Review affordances as overlays and controls around the shared document.
5. Run the full Sheaf Chat UI and integration test suites, then perform the final split-path coverage audit.
