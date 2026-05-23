# Issues

## Issue POL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-05-23T21:55:28Z
- updated_at: 2026-05-23T21:59:44Z
- title: `code_read` returns the wrong shape for real VS Code empty files
- details: `apps/vscode-extension/src/tools/codeRead.ts` treats a file as empty only when `doc.lineCount === 0`. The slice spec explicitly requires empty files to return `lineCount: 0`, `startLine: 0`, `endLine: 0`, and an empty `lines` array. Real VS Code `TextDocument` instances report an empty text file as one empty line (`lineCount === 1`, `getText() === ""`), so the production extension will currently return one blank line with `lineCount: 1` instead of the required degenerate empty-file result. The existing test passes because `MemoryEditorAccess.OpenedFromLines()` models `SeedFile("empty.txt", [])` as `lineCount: 0`, which does not match VS Code's real empty-document behavior.

  To mark this issue `completed`, `code_read` must detect real empty documents by content semantics rather than relying only on `lineCount === 0`, and it must return the spec's empty-file result for a VS Code-shaped empty document (`lineCount: 1`, first line `""`, full text `""`). Add or adjust focused coverage so the fake editor can model the real VS Code empty-file shape and the test fails without the production fix.
- resolution_notes: Verified the fix. `code_read` now treats a document with empty full text as the spec's degenerate empty-file case, covering VS Code's real empty-document shape (`lineCount: 1` with one empty line). The fake editor was updated to mirror that VS Code behavior, and the empty-file test now asserts both the fake document shape and the required `code_read` result.

## Issue POL-0002

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-05-23T21:55:28Z
- updated_at: 2026-05-23T21:59:44Z
- title: `rgrep` reports truncation when the match count exactly equals `maxMatches`
- details: `apps/vscode-extension/src/tools/rgrep.ts` pushes a match and immediately sets `truncated = true` when `matches.length >= maxMatches`. That makes searches with exactly `maxMatches` total matches report `truncated: true` even though no additional matches exist. The spec defines `maxMatches` as a response bound and `truncated` as the signal that more results were omitted, so this false positive can cause the model to think a complete result set is incomplete and continue navigating unnecessarily.

  To mark this issue `completed`, `rgrep` must set `truncated: true` only after it has established that at least one additional match would be omitted. The returned `matches` array must still contain at most `maxMatches` entries. Add focused coverage for both exact-bound (`matches.length === maxMatches`, `truncated === false`) and over-bound (`more than maxMatches`, `truncated === true`) cases.
- resolution_notes: Verified the fix. `rgrep` now checks for overflow before pushing a match, so exact-bound results keep `truncated: false` while over-bound results omit the extra match and set `truncated: true`. The added test covers both exact-bound and over-bound behavior.
