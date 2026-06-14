## Why

Sheaf Chat's file workspace currently renders non-Markdown text files as plain
escaped text, which makes code harder to scan during chat-driven development.
Basic syntax highlighting by file extension would make opened source and config
files easier to read without introducing an editor, LSP, symbol resolution, or
other advanced code-intelligence behavior.

## What Changes

- Add client-side syntax highlighting for selected `text/*` file previews when
  the file extension maps to a supported language.
- Cover C++, Python, TypeScript, JavaScript, JSON, XML/HTML, YAML, Swift, and
  Bash in the initial language map.
- Keep Markdown file preview behavior unchanged.
- Keep unsupported and unknown text files on the current escaped plain-text
  fallback.
- Serve the required Highlight.js JavaScript and theme assets from the existing
  explicit vendor-asset allowlist.
- Do not add LSP integration, symbol resolution, editing, diagnostics, or
  Markdown fenced-code-block highlighting in this change.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-file-browser`: selected text-file previews may render with basic
  syntax highlighting when the file extension maps to a supported language.
- `sheaf-chat-chat-ui`: the browser shell loads Highlight.js vendor assets
  needed by the file workspace.
- `sheaf-chat-service`: the vendor asset allowlist includes the Highlight.js
  browser script and theme CSS.

## Impact

- Affected code:
  - `projects/sheaf-chat/src/ui/index.html`
  - `projects/sheaf-chat/src/ui/sheaf-chat.js`
  - `projects/sheaf-chat/src/ui/sheaf-chat.css`
  - `projects/sheaf-chat/src/server/static.ts`
  - `projects/sheaf-chat/package.json`
  - `projects/sheaf-chat/package-lock.json`
- Affected tests:
  - `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
  - `projects/sheaf-chat/tests/server/static.test.ts`
  - Browser/integration coverage if needed for real asset loading
- Adds a runtime browser dependency on Highlight.js served locally from
  `node_modules`; no remote CDN requests are introduced.
