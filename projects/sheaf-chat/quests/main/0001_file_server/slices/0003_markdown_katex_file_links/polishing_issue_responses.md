# Issue responses

## Response PL-0001 2026-06-10T04:06:23Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Aligned the KaTeX font vendor URL prefix with katex.min.css relative fonts/ references and added a static test that reads katex.min.css, resolves an actual font url() against the stylesheet path, and verifies the resolved font asset is served with a font content type.

## Response PL-0003 2026-06-10T04:06:23Z

- issue_id: PL-0003
- outcome: Fixed
- explanation: Escaped the original math source before restoring fallback placeholders when KaTeX is unavailable or renderToString fails. Added a test that renders HTML-like math without KaTeX and asserts no live img markup is injected.

## Response PL-0002 2026-06-10T04:06:23Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Updated math protection to apply substitutions only outside detected Markdown inline code spans and fenced code blocks. Added a renderer test proving literal dollar content in inline/fenced code is preserved while normal paragraph math still renders.
