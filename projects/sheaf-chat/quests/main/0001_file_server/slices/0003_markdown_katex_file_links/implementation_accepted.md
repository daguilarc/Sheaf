# Slice 3 — Markdown, KaTeX, and File Links: Implementation Accepted

## Decision

Accepted. The slice implements its specified scope and all polishing issues
raised during review have been fixed and verified.

## Scope delivered

- Shared `window.SheafMarkdown` browser helper (`src/ui/sheaf-markdown.js`)
  exposing `renderMarkdown`, `enhanceRenderedLinks`, and `resolveFileLink`.
- Markdown-it (`html: false`, `linkify: true`) plus KaTeX rendering for
  `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, with safe escaping and a legacy
  fallback.
- Allowlisted `/assets/vendor` serving for markdown-it, KaTeX JS/CSS, and
  KaTeX fonts in `src/server/static.ts`, with font content types and vendor
  traversal rejection.
- `index.html` loads the vendor + helper scripts before `agui-chat.js`;
  `agui-chat.js` prefers `SheafMarkdown.renderMarkdown` and calls
  `enhanceRenderedLinks` after assistant content updates.
- Safe file-link resolution (relative, root-relative, `sheaf-file:`,
  fragments) with rejection of traversal, protocol/protocol-relative URLs,
  backslashes, NULs, and absolute paths; `.md`/`.markdown` treated as
  file-view candidates. Shared Markdown/KaTeX CSS for chat and file view.

## Review findings and resolution

Three issues were filed on the first pass and all fixed in step 18 (commit
`e7f82ee`) and verified on this pass:

- **PL-0001 (completed, high)** — KaTeX font URLs would 404 because the served
  font prefix did not match `katex.min.css`'s relative `url(fonts/...)`
  references. Fixed by serving fonts under `/assets/vendor/fonts`, matching
  how the browser resolves the stylesheet's font URLs. A new static test reads
  the actual CSS, resolves a real `url(...)` font reference against the
  stylesheet path, and asserts it serves with a `font/` content type. Vendor
  traversal rejection still holds.
- **PL-0002 (completed, medium)** — Math substitution leaked into fenced/inline
  code and mis-fired on currency because regexes ran over the raw source.
  Fixed by detecting code ranges (`FindCodeRanges`) and substituting only
  outside them (`ReplaceOutsideRanges`), plus a tighter inline regex. Tests
  confirm `` `$x$` ``, `cp $a $b`, `$$not math$$`, and `$5 to $10` stay
  literal while only real paragraph math renders.
- **PL-0003 (completed, low)** — The KaTeX-unavailable fallback injected raw
  unescaped math source post-render, bypassing `html: false`. Fixed by
  `EscapeHtml(match)` on the fallback path; a test renders HTML-like math
  without KaTeX and asserts the markup is escaped.

## Test coverage

UI tests cover Markdown/KaTeX rendering, code-span/fence protection, fallback
escaping, the legacy fallback path, and file-link resolution (including
traversal/protocol rejection and callback shape). Static tests cover vendor
serving, the CSS-referenced font path, and vendor traversal rejection. Per
reviewer policy, tests were not run during review; sufficiency was assessed
from the changed test code and the implementer/polisher reported outcomes
(`npm test` — 151 passing at implementation, plus the added regression tests).

## Notes for later slices

- `enhanceRenderedLinks` accepts `onFileLink(path, fragment)` via context;
  slice 4 should pass this from the file tab system.
- File-view Markdown can reuse `SheafMarkdown.renderMarkdown` directly.
