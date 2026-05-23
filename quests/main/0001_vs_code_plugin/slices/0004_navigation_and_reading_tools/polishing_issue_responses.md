# Issue responses

## Response POL-0001 2026-05-23T21:58:00Z

- issue_id: POL-0001
- outcome: Fixed
- explanation: Updated `apps/vscode-extension/src/tools/codeRead.ts` so the
  empty-document branch triggers when either `doc.lineCount === 0` or
  `doc.getText().length === 0`. This matches VS Code's real `TextDocument`
  shape, which reports an empty text file as `lineCount: 1` with a single
  empty line, and still returns the spec's degenerate result
  (`lineCount: 0`, `startLine: 0`, `endLine: 0`, empty `lines`). To make the
  fake editor model real VS Code behavior, `OpenedFromLines` in
  `apps/vscode-extension/test/helpers/memoryEditorAccess.ts` now reports an
  empty seeded file as `lineCount: 1` with one empty line while
  `getText()` returns `""`. The existing `code_read empty file` test was
  strengthened in `apps/vscode-extension/test/tools/codeRead.test.ts` to
  assert the VS Code-shaped document (`lineCount === 1`, `lineTextAt0(0) === ""`,
  `getText() === ""`) and to verify the tool still returns the spec's
  empty-file result. This test fails without the production change in
  `codeRead.ts` (the tool would otherwise return `lineCount: 1` with a
  single blank line). `npm test` passes (29/29) and `npm run lint` is clean.

## Response POL-0002 2026-05-23T21:58:00Z

- issue_id: POL-0002
- outcome: Fixed
- explanation: Reworked the truncation logic in
  `apps/vscode-extension/src/tools/rgrep.ts` so `truncated` only becomes
  `true` after the loop encounters a match that would push `matches.length`
  past `maxMatches`. The overflow check is now performed before pushing the
  new match, so the returned `matches` array still contains at most
  `maxMatches` entries and exact-bound results report `truncated: false`.
  Added focused coverage in
  `apps/vscode-extension/test/tools/rgrep.test.ts`
  (`rgrep truncated is false when match count equals maxMatches`) that
  exercises both the exact-bound case (`maxMatches: 3` over three matches →
  `matches.length === 3`, `truncated === false`) and the over-bound case
  (`maxMatches: 2` over three matches → `matches.length === 2`,
  `truncated === true`). `npm test` passes (29/29) and `npm run lint` is
  clean.
