# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-10T04:02:05Z
- updated_at: 2026-06-10T04:02:05Z
- title: KaTeX fonts 404: served font path does not match katex.min.css url() references
- details: ## What is wrong

KaTeX web fonts will 404 in the browser because the URL where the server
serves the font files does not match the URL that `katex.min.css` actually
requests.

- `index.html` loads the stylesheet at `/assets/vendor/katex.min.css`
  (`x_katexCssPath`).
- `node_modules/katex/dist/katex.min.css` references its fonts with
  **relative** URLs, e.g. `url(fonts/KaTeX_Main-Regular.woff2)`.
- A relative `fonts/...` URL inside a stylesheet served at
  `/assets/vendor/katex.min.css` resolves (per the browser's CSS URL
  resolution rules) to `/assets/vendor/fonts/KaTeX_Main-Regular.woff2`.
- But `BuildVendorAssetAllowlist` (`src/server/static.ts`) only serves font
  files under `x_katexFontsUrlPrefix` = `/assets/vendor/katex/fonts/...`.

So the browser requests `/assets/vendor/fonts/KaTeX_Main-Regular.woff2`, which
is not in the allowlist, and the server returns 404. None of the KaTeX fonts
load.

## Why it is a problem

KaTeX falls back to system fonts when its own fonts are missing, which renders
math with broken metrics, missing glyphs, and misaligned symbols. Correct
KaTeX rendering is a core objective of this slice ("Assistant chat messages
render Markdown and supported LaTeX through Markdown-it/KaTeX"), so the
feature is visually broken end-to-end even though `renderToString` produces
markup.

The existing static test only asserts that a font is resolvable at the
`/assets/vendor/katex/fonts/...` path the server chose; it never fetches the
URL the CSS actually references, so the mismatch is not caught.

## What must be true to close

- The font URL that `katex.min.css` references (as actually served to the
  browser) resolves to a served font file (HTTP 200 with a font content
  type). Acceptable fixes include: serving the stylesheet from a path whose
  directory makes `fonts/...` resolve to the served font prefix, serving the
  fonts under `/assets/vendor/fonts/...`, or rewriting the CSS `url(...)`
  references — any approach that makes the served CSS's font references load.
- A test exercises the real path: fetch `katex.min.css` over HTTP, extract a
  `url(...)` font reference, resolve it against the stylesheet URL, fetch that
  resolved URL, and assert HTTP 200 with a font content type. (A unit-level
  equivalent that resolves the CSS-referenced relative URL against the served
  CSS path and asserts it is in the vendor allowlist is also acceptable.)
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-10T04:02:09Z
- updated_at: 2026-06-10T04:02:09Z
- title: Math substitution leaks into code blocks/inline code and produces false positives
- details: ## What is wrong

`ProtectMath` in `src/ui/sheaf-markdown.js` runs its `$...$`, `$$...$$`,
`\(...\)`, and `\[...\]` regex substitutions over the **raw Markdown source
before** it is handed to markdown-it. Because this happens before
tokenization, it also rewrites math-looking text that appears inside fenced
code blocks and inline code spans, and it produces false positives on
ordinary text.

Examples that render incorrectly:

- Inline code: `` `$x$` `` becomes a placeholder, and after `RestoreMath`
  the final HTML is `<code><span class="sheaf-markdown-math">...KaTeX...</span></code>`
  instead of literal `$x$` inside the code span.
- Fenced code: a shell snippet such as `cp $a $b` matches the inline rule
  (`\$([^$\n]+?)\$` captures `a `), so the rendered code block shows
  KaTeX-rendered math instead of the literal shell command.
- Prose false positives: currency like `it costs $5 to $10` matches `$5 to $`.

## Why it is a problem

This is a coding/agent chat surface, where assistant messages very commonly
contain shell snippets, environment variables (`$VAR`), and code with literal
`$` characters. Converting those to KaTeX inside code blocks corrupts the
displayed content and is the opposite of what a Markdown code block must do
(show text verbatim). The slice spec called for "a small local rule pair" for
the math delimiters — implemented as markdown-it inline/block rules, math
substitution would not fire inside code spans/fences. The chosen
pre-tokenization regex approach bypasses that protection.

## What must be true to close

- Math substitution must not occur inside fenced code blocks or inline code
  spans; such regions render verbatim (e.g. `` `$x$` `` stays literal `$x$`).
- The fix is covered by a test asserting that `$...$`/`$$...$$` inside inline
  code and fenced code blocks is preserved as literal text (not wrapped in a
  `sheaf-markdown-math` span), while math in normal paragraph text still
  renders.
- Acceptable approaches include implementing the math as markdown-it
  inline/block rules, or protecting code spans/fences before applying the
  math regexes. Currency false positives outside code are lower priority but
  should be noted if not addressed.
- resolution_notes: none

## Issue PL-0003

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-10T04:02:09Z
- updated_at: 2026-06-10T04:02:09Z
- title: KaTeX-unavailable fallback injects raw unescaped math source (XSS)
- details: ## What is wrong

In `ProtectMath` (`src/ui/sheaf-markdown.js`), when KaTeX rendering returns
`null`, the placeholder is set to the **raw matched source text** (`match`):

```js
placeholders.push(
  rendered != null
    ? '<span class="sheaf-markdown-math...">' + rendered + '</span>'
    : match            // <-- raw, unescaped Markdown source
);
```

`RestoreMath` later splices these placeholders back into the HTML **after**
markdown-it has finished rendering, so the raw `match` text is injected into
the final HTML without passing through markdown-it's escaping. `RenderKatex`
returns `null` whenever `katex` is undefined (the vendor script failed to
load) or `renderToString` throws.

So if KaTeX is not loaded and an assistant message contains, e.g.,
`$<img src=x onerror=alert(1)>$`, the matched text is injected raw into the
DOM as an `<img>` element, executing the handler. markdown-it is configured
with `html: false` specifically to prevent this, but the math-restore path
defeats that protection in the fallback case.

## Why it is a problem

Assistant/chat content is only semi-trusted (LLM output, possibly influenced
by injected file or tool content). The whole point of `html: false` is that
Markdown content cannot inject executable HTML. The fallback path reopens that
hole whenever KaTeX is unavailable (a plausible degraded state — a single
failed vendor request). Severity is bounded by "KaTeX failed to load," hence
lower priority than the font and code-block issues, but it is a genuine XSS
vector and a trivial fix.

## What must be true to close

- When KaTeX rendering is unavailable/fails, the original math text is
  HTML-escaped before being used as the placeholder, so it cannot inject
  executable HTML into the rendered output.
- A test renders Markdown containing a `$...$`/`$$...$$` span with HTML-like
  content while KaTeX is absent and asserts the dangerous markup is escaped
  (no live `<img>`/`<script>` element; the literal text is shown).
- resolution_notes: none
