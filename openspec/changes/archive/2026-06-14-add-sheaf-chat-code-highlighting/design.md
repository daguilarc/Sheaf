## Context

Sheaf Chat already has a read-only file workspace inside the chat screen. The
server reads whole text files from the session root and returns `contentType`
plus the full UTF-8 content. The browser then renders Markdown files through
`window.SheafMarkdown` and renders other `text/*` files as escaped plain text in
a `<pre>`.

The requested behavior is presentation-only syntax highlighting based on file
extension. It should make common code/config files easier to read without
turning the preview pane into an editor or adding code-intelligence features.

## Goals / Non-Goals

**Goals:**

- Highlight opened file previews for C++, Python, TypeScript, JavaScript, JSON,
  XML/HTML, YAML, Swift, and Bash.
- Infer the language from the selected file's root-relative path, not from
  automatic language detection.
- Keep unknown text files, unsupported files, Markdown previews, and highlighter
  failure paths graceful.
- Serve all highlighting assets locally through the existing vendor-asset
  allowlist.

**Non-Goals:**

- No LSP, symbol resolution, diagnostics, outline, editing, diffing, or
  formatter integration.
- No requirement to highlight Markdown fenced code blocks in chat messages or
  Markdown file previews.
- No remote CDN usage.
- No server-side parsing of file contents for syntax metadata.

## Decisions

1. Use Highlight.js as a browser-side dependency.

   Highlight.js is small enough for basic preview highlighting, supports every
   requested language, and returns escaped/tokenized HTML suitable for static
   previews. Alternatives considered:

   - Monaco or CodeMirror: more powerful, but they imply editor-style behavior,
     larger integration work, and more UI surface than this change needs.
   - A custom tokenizer: smaller for one language, but immediately becomes
     underpowered for the requested language set.
   - Shiki: high-quality highlighting, but it is heavier and more build/runtime
     complexity than needed for plain file previews.

2. Select languages by extension rather than auto-detecting.

   The file workspace already knows the selected path, so extension mapping is
   deterministic, faster, and less surprising than asking the highlighter to
   guess from content. This also avoids accidental mis-highlighting for JSON,
   YAML, shell snippets, or header files. `.h` is mapped to C++ for this first
   version because C++ is the user's primary header-file expectation.

3. Keep highlighting entirely in the file preview branch.

   `src/ui/sheaf-chat.js` owns selected-file rendering and can decide between
   Markdown, highlighted code, plain text, and unsupported messages without API
   changes. Markdown files continue through `SheafMarkdown`; Markdown fenced
   code block highlighting can be proposed separately if it becomes important.

4. Serve a bounded local Highlight.js asset set.

   The implementation should add Highlight.js to `projects/sheaf-chat` and
   allowlist only the browser script and chosen theme CSS under `/assets/vendor`.
   The page loads these before `sheaf-chat.js`, matching the existing
   Markdown-it/KaTeX pattern. If the selected package layout requires separate
   language modules, those modules should also be explicit allowlist entries,
   not wildcard served from `node_modules`.

## Risks / Trade-offs

- Highlighting very large files may add UI-thread work -> keep the current
  whole-file preview model, use explicit language selection, and preserve plain
  fallback if Highlight.js is unavailable or errors.
- Header extension ambiguity (`.h`) may be wrong for C projects -> map `.h` to
  C++ initially because this feature is tuned to the requested language set; it
  can become configurable later if needed.
- Vendor asset paths can drift across Highlight.js package versions -> cover the
  allowlist with static route tests that resolve and fetch the real files.
- Theme colors may not fit Sheaf Chat's dark UI -> choose or override a dark
  theme and test both text readability and scroll/line wrapping in the file
  pane.

## Migration Plan

Install the Highlight.js package in `projects/sheaf-chat`, add the explicit
vendor assets, update the browser shell, and add file-view rendering tests. No
data migration or protocol migration is required. Rollback is removing the
Highlight.js assets and restoring `text/*` previews to the existing plain
`<pre>` path.

## Open Questions

- Which Highlight.js theme should be the default? A dark bundled theme should be
  selected during implementation and adjusted with local CSS if needed.
