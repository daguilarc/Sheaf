## 1. Vendor Assets

- [x] 1.1 Add Highlight.js to `projects/sheaf-chat/package.json` and update `package-lock.json`.
- [x] 1.2 Select a dark Highlight.js theme that fits the Sheaf Chat file pane.
- [x] 1.3 Extend `src/server/static.ts` with explicit Highlight.js script and theme URL constants and allowlist entries.
- [x] 1.4 Update `src/ui/index.html` to load the Highlight.js theme and script before `sheaf-chat.js`.

## 2. File Preview Highlighting

- [x] 2.1 Add a deterministic extension-to-language helper for C++, Python, TypeScript, JavaScript, JSON, XML/HTML, YAML, Swift, and Bash.
- [x] 2.2 Update non-Markdown `text/*` file rendering to use Highlight.js when a language mapping exists.
- [x] 2.3 Preserve escaped plain-text fallback for unmapped text files, missing `window.hljs`, and highlighter failures.
- [x] 2.4 Add or adjust CSS so highlighted code previews preserve existing wrapping/scroll behavior and remain readable in the dark UI.

## 3. Tests

- [x] 3.1 Add UI unit tests for mapped language highlighting, JSON highlighting, unmapped plain-text fallback, and highlighter-unavailable fallback.
- [x] 3.2 Add static asset tests for resolving and fetching the Highlight.js script and theme.
- [x] 3.3 Run `make sheaf-chat-test`.
- [x] 3.4 Run a browser smoke test opening at least one highlighted file preview, preferably C++ or Python plus JSON.
