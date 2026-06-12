# Sheaf Unstaged Hunk Pane

VS Code extension for browsing, staging, reverting, and undoing unstaged Git
hunks from the active editor. The extension owns a custom peek-like webview:
it opens when the active file has unstaged hunks and hides when there is
nothing actionable.

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
