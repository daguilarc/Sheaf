# Sheaf Inline Unstaged Hunks

VS Code extension for browsing, staging, reverting, and undoing unstaged Git
hunks from the active editor. The extension renders worktree-vs-index hunks in
a read-only `sheaf-hunks:` virtual document opened in the editor area: additions
are highlighted in green, deletions are shown on separate red rows, and the
current hunk is brighter than surrounding hunks.

Deleted text is synthesized into the virtual document, not inserted into the
real source file. That keeps every displayed source line on its own viewport row
while preserving the user's actual buffer. The virtual rows are read-only review
content, so commands map back to the underlying repo file through the hunk
mapping layer. For replacement hunks, added code is grouped together first and
deleted code is grouped immediately after it instead of interleaving old and new
lines.

Previous/next hunk navigation and previous/next file navigation refresh the
virtual document and reveal the selected hunk in the active editor viewport.
Launchpad and Dictator state still use the existing `paneOpen` controller field,
but it now means that the editor-integrated hunk review surface is active; no
separate webview panel is opened or retained.

## Commands

- `sheaf.hunks.previousHunk`
- `sheaf.hunks.nextHunk`
- `sheaf.hunks.previousFile`
- `sheaf.hunks.nextFile`
- `sheaf.hunks.getCurrentHunk`
- `sheaf.hunks.stageCurrentHunk`
- `sheaf.hunks.revertCurrentHunk`
- `sheaf.hunks.undo`

## Dictator Integration

Set `sheaf.hunks.dictatorBaseUrl` to the local Dictator service URL. The
default is `http://127.0.0.1:9003`.

The extension posts state snapshots to Dictator whenever VS Code focus,
active editor, open document contents, watched workspace files, or command
results change. It also sends heartbeats and polls for commands targeted at
its generated window id. On shutdown it best-effort posts a disconnect; if
that is missed, Dictator drops the instance after heartbeat expiry.

## Validation

From this directory:

```bash
npm test
npm run build
```
