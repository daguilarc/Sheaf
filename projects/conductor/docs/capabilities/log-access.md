# Capability: Log Access

ID prefix: `log`

## Purpose

Read-only access to service log files for humans and the log viewer page: a
REST endpoint that lists the files under a service's log directory, and a
WebSocket protocol that streams bounded byte ranges of one file at a time —
initial tail, scrollback (`read_before`), and live follow. File paths are
named only inside WebSocket messages, never in URLs, and every path is
validated against the service's log root.

## Requirements

### Listing

- **[log-1]** WHEN it receives `GET /api/services/<name>/logs` for a
  registered service, THE service SHALL respond 200 with
  `{name, log_root: "logs/<name>/", files}` where `files` lists every regular
  file under `<repo>/logs/<name>/` recursively — each entry
  `{path, size, modified_at}` with `path` relative to the log root using `/`
  separators, `size` in bytes, and `modified_at` the ISO-8601 mtime — sorted
  by `path`; IF the log directory does not exist, THEN `files` SHALL be `[]`;
  non-files (subdirectory entries themselves, sockets, etc.) are skipped.
  Unknown services get 404 `{"error": "service not found"}`.

### WebSocket session

- **[log-2]** THE service SHALL accept WebSocket upgrades at
  `GET /api/services/<name>/logs/stream` for registered services; IF the path
  matches that pattern but the service is unknown, THEN THE service SHALL
  reject the upgrade with a plain HTTP `404 Not Found` response; IF an
  upgrade arrives on any other path, THEN THE service SHALL destroy the
  socket.
- **[log-3]** WHEN it receives `{"type": "open", "file": <relative path>,
  "tail_bytes": <n>}`, THE session SHALL validate the path (log-7), read the
  final `min(tail_bytes, 65536)` bytes of the file (whole file when shorter;
  `tail_bytes` defaults to 65536 when absent or not a positive number), and
  send one `chunk` message whose `start`/`end` are the absolute byte offsets
  read and whose `file` is the normalized relative path. The session then has
  that file open, with the follow offset at the file's size and follow
  disabled.
- **[log-4]** WHEN it receives `{"type": "read_before", "before": <offset>,
  "max_bytes": <n>}` with a file open, THE session SHALL send one `chunk`
  covering bytes `[max(0, before - min(max_bytes, 65536)),
  min(before, current file size))` (`max_bytes` defaults to 65536; offsets
  are stable file positions, so scrollback never shifts).
- **[log-5]** WHILE follow is enabled (`{"type": "follow", "enabled": true}`
  with a file open), THE session SHALL poll the file size every 250 ms
  (default `followPollIntervalMs`) and send an `append` message carrying
  exactly the bytes added since the last sent offset; `enabled: false` stops
  polling. Overlapping polls are skipped, not queued.
- **[log-6]** IF the open file's size shrinks below the follow offset, or a
  follow read fails, THEN THE session SHALL stop following, forget the open
  file, and send the error
  `log file was truncated or rotated; reopen the file`; the client must send
  a new `open` to resume.
- **[log-7]** THE session SHALL reject unsafe paths before any read: empty
  paths, absolute paths (leading `/` or `\`), and paths containing a `..`
  segment are invalid; after resolution, the target must lie inside the
  service log root both lexically and after symlink resolution (`realpath`),
  and must be a regular file. Violations produce the error messages in the
  catalogue and leave no file open.
- **[log-8]** IF a client message is malformed or invalid, THEN THE session
  SHALL reply with an `error` message from the catalogue and otherwise keep
  the session state unchanged.
- **[log-9]** THE session SHALL cap every read at 65536 bytes
  (`DEFAULT_MAX_READ_BYTES`), hold at most one open file (a new `open`
  replaces the previous file and stops follow polling), and release all
  timers and state when the socket closes.

## Contracts

All messages are single JSON objects, one per WebSocket frame.

### Client → server

```json
{ "type": "open", "file": "quest-runner_stdout.log", "tail_bytes": 65536 }
{ "type": "read_before", "before": 983040, "max_bytes": 65536 }
{ "type": "follow", "enabled": true }
```

`tail_bytes` and `max_bytes` are optional; non-number or non-positive values
fall back to the 65536 default, and values above 65536 are clamped.

### Server → client

```json
{ "type": "chunk", "file": "quest-runner_stdout.log", "start": 917504, "end": 983040, "text": "..." }
{ "type": "append", "file": "quest-runner_stdout.log", "start": 983040, "end": 983262, "text": "..." }
{ "type": "error", "message": "log file not found" }
```

`chunk` answers `open` and `read_before`; `append` is sent only while follow
is enabled. `start`/`end` are absolute byte offsets; `text` is the bytes
decoded as UTF-8.

### `GET /api/services/<name>/logs` — 200

```json
{
  "name": "quest-runner",
  "log_root": "logs/quest-runner/",
  "files": [
    { "path": "quest-runner_stderr.log", "size": 1024, "modified_at": "2026-06-10T12:00:00.000Z" },
    { "path": "quest-runner_stdout.log", "size": 4096, "modified_at": "2026-06-10T12:00:00.000Z" }
  ]
}
```

### Error catalogue (WebSocket `error.message`, exact)

| Condition | Message |
|---|---|
| Frame is not parseable JSON | `malformed JSON message` |
| Missing or unrecognized `type` | `unknown message type` |
| `open` without a string `file` | `open requires a file path` |
| `open`/`read_before` path empty, absolute, contains `..`, or escapes the log root (incl. via symlink) | `invalid log file path` |
| Target file does not exist | `log file not found` |
| Target is a directory | `log path is a directory` |
| Target exists but is not a regular file | `log path is not a file` |
| `read_before` without a numeric `before` | `read_before requires a before offset` |
| `read_before` with negative or non-finite `before` | `read_before requires a non-negative before offset` |
| `read_before`/`follow` with no open file | `no log file is open` |
| `follow` without a boolean `enabled` | `follow requires an enabled boolean` |
| File truncated/rotated or follow read failed | `log file was truncated or rotated; reopen the file` |

| Condition | HTTP outcome |
|---|---|
| `GET .../logs` for unknown service | 404 `{"error": "service not found"}` |
| Upgrade on `.../logs/stream` for unknown service | HTTP `404 Not Found`, socket closed |
| Upgrade on any other path | socket destroyed without an HTTP response |

## Design

- `src/logs.ts` — `listServiceLogs` (recursive walk, ENOENT → empty),
  `normalizeRelativeLogPath` / `resolveLogFilePath` (lexical checks),
  `validateLogFileForReading` (stat + `realpath` containment; the symlink
  check happens after the file-kind checks).
- `src/log_stream.ts` — `LogStreamSession` with `HandleOpen`,
  `HandleReadBefore`, `HandleFollow`, `Destroy`; `computeTailRange`,
  `computeReadBeforeRange`, `readByteRange` (positional `fs` read, no stream
  state); truncation detection compares stat size against the follow offset.
- `src/websocket.ts` — upgrade matching (`matchLogStreamUpgradePath`),
  `rejectUpgradeWithHttpStatus` (raw HTTP response written to the socket),
  `attachLogStreamConnection` (one `LogStreamSession` per connection;
  messages serialized with `JSON.stringify`, sent only while the socket is
  OPEN), and the client-message dispatcher.
- The log root for service `<name>` is `repoPaths.serviceLogRoot(name)` =
  `<repo>/logs/<name>` (`src/paths.ts`), matching where
  [service-management](service-management.md) start actions write.
- Tests: `tests/logs.test.ts`, `tests/log_stream.test.ts`,
  `tests/log_websocket.test.ts` (end-to-end over real sockets, including
  truncation and unsafe-path rejection).

## Interactions

- [service-management](service-management.md) — produces the log files
  (svc-16) and owns the service-name 404 rule; `/exit` shutdown also rejects
  in-flight upgrades.
- [web-ui](web-ui.md) — the logs page is the protocol's only in-repo client.
- [structure/services.md](../../../../structure/services.md) — the
  `logs/<service_name>/` layout convention.
