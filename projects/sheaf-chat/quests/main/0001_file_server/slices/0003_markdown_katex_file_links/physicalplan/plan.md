# Slice 3: Markdown, KaTeX, And File Links

## Objective

Replace the ad hoc chat Markdown formatter with a Markdown-it and KaTeX rendering pipeline and expose reusable browser helpers for rendering Markdown files and resolving safe file links into the tab system.

Expected outcome:

- Assistant chat messages render Markdown and supported LaTeX through Markdown-it/KaTeX.
- Markdown files render through the same pipeline or equivalent shared browser configuration.
- File links under the current chat root can be identified and routed to the file viewer instead of the browser.
- External links and unsupported file targets continue to behave as ordinary links under existing browser security behavior.

## Key Files And Systems

- `projects/sheaf-chat/package.json`
- `projects/sheaf-chat/package-lock.json`
- `projects/sheaf-chat/src/server/static.ts`
- `projects/sheaf-chat/src/ui/index.html`
- `projects/sheaf-chat/src/ui/sheaf-chat.js`
- `projects/sheaf-chat/src/ui/sheaf-chat.css`
- `projects/web/src/agui-chat.js`
- `projects/web/src/agui-chat.css`
- `projects/sheaf-chat/tests/agui/snapshots.test.ts`
- `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- `projects/sheaf-chat/tests/server/static.test.ts`

## Existing APIs To Reuse

- Reuse the static asset serving system in `server/static.ts`.
- Reuse `ChatView`'s existing `UpdateAssistantContent` hook rather than creating a second chat renderer.
- Reuse the Sheaf UI's plain browser-script style. Do not introduce a frontend framework or a bundler for this quest.
- Reuse browser `URL` parsing for link classification, backed by server validation when a file is fetched.

## APIs To Extend Or Modify

- Add `markdown-it` and `katex` as package dependencies.
- Serve exact allowlisted browser assets from installed dependencies, for example:
  - `/assets/vendor/markdown-it.min.js`
  - `/assets/vendor/katex.min.js`
  - `/assets/vendor/katex.min.css`
  - required KaTeX font assets under an allowlisted `/assets/vendor/katex/fonts/` prefix.
- Extend static content types as needed for `.woff`, `.woff2`, `.ttf`, and `.css`.
- Add a small browser helper loaded before `agui-chat.js` and `sheaf-chat.js`, for example `window.SheafMarkdown`, with:
  - `renderMarkdown(markdown, options): string`
  - `enhanceRenderedLinks(container, context): void`
  - `resolveFileLink(href, basePath, rootMode): { path: string; fragment?: string } | null`
- Update `ChatView` to use `window.SheafMarkdown.renderMarkdown` when available, falling back only if dependencies fail to load.
- Update Sheaf chat/file viewer code in later slices to pass an `onFileLink(path, fragment)` callback into `enhanceRenderedLinks`.

## Rendering Details

- Configure Markdown-it with `html: false`, `linkify: true` only if acceptable to current UI behavior, and safe escaping enabled by default.
- Add KaTeX support through a Markdown-it math plugin if available, or a small local rule pair for `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` that calls `katex.renderToString` with `throwOnError: false`.
- Add CSS for Markdown content shared by chat assistant bubbles and file view content:
  - headings, paragraphs, lists, blockquotes, tables, code blocks, inline code, links, and KaTeX overflow handling.
- Keep user messages as plain text unless implementation chooses to render them deliberately; the spec requires assistant output and files.
- Keep tool/reasoning panels as text unless a later product decision says otherwise.

## File-Link Resolution

File-view links:

- Resolve relative links from the directory of the Markdown file containing the link.
- Resolve root-relative links from the chat root when href starts with `/`.
- Strip and preserve fragments after `#`.
- Decode URL path segments safely, normalize `.` segments, reject `..`, absolute filesystem paths, protocol URLs, protocol-relative URLs, backslash separators, NULs, and empty targets.
- Treat `.md` and `.markdown` targets as file-view candidates. Other local targets remain ordinary links until non-Markdown support is explicitly added by implementation.

Chat-message links:

- Support the explicit Sheaf file-link format `sheaf-file:<relative-path>` to avoid ambiguous relative assistant links. Fragments are allowed, for example `sheaf-file:docs/readme.md#section`.
- Also support root-relative Markdown links such as `/docs/readme.md` when the current chat root context is available.
- Support simple relative Markdown links from assistant messages only when the UI has a safe base path. If no base path exists, leave them as ordinary links.

Security:

- Client-side resolution is an optimization for routing. Server file APIs from slice 1 remain authoritative and must reject unsafe targets.
- Rendered HTML must not allow raw HTML execution from Markdown content.

## Validation

- Unit-style UI tests for Markdown rendering of headings, emphasis, code, links, and KaTeX inline/block math in assistant messages.
- UI tests for file-link resolver: relative links, root-relative links, fragments, encoded traversal rejection, absolute/protocol URL pass-through, unsupported extensions pass-through, and already-open tab callback invocation shape.
- Static tests proving vendor assets are served from explicit allowlists and path traversal under vendor routes is rejected.
- Snapshot tests updated only where rendered Markdown structure intentionally changes.
- Run `npm test` in `projects/sheaf-chat`.
