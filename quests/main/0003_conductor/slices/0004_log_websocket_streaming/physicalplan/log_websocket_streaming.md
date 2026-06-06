# Physical Plan: Log WebSocket Streaming

## Objective

Implement the browser-facing WebSocket log API for safe, byte-offset-based log viewing: open a selected file by message, send only the requested tail window, load earlier byte ranges on demand, follow appended bytes, and handle truncation or rotation gracefully.

Expected outcome:

- `GET /api/services/{service_name}/logs/stream` upgrades to a WebSocket for known services.
- The client selects a relative log file with an initial `{ "type": "open", "file": "...", "tail_bytes": ... }` message.
- The server rejects unknown services, unknown files, absolute paths, and path traversal.
- `open` sends a bounded `chunk` message for the requested tail window, not the full file.
- `read_before` sends earlier bounded byte ranges with stable offsets.
- `follow` toggles live appended-data delivery through `append` messages.
- File truncation or rotation sends a clear event and leaves the connection usable for a future reopen.

## Key Files And Systems

- Add `projects/conductor/src/log_stream.ts` for log file session state, byte-range reads, follow polling, and rotation/truncation detection.
- Add `projects/conductor/src/websocket.ts` or integrate with `server.ts` upgrade handling using `ws`.
- Extend `projects/conductor/package.json` dependencies with `ws` and dev dependency `@types/ws` if not already present.
- Reuse or extend `projects/conductor/src/logs.ts` for file path validation.
- Add WebSocket tests under `projects/conductor/tests/log_stream*.ts` and `projects/conductor/tests/log_websocket*.ts`.

## Existing APIs To Reuse As-Is

- Reuse service lookup from slice 0002.
- Reuse log root and safe relative path resolution helpers from slice 0003.
- Reuse the `ws` package, matching the existing repo dependency style used by `apps/realtime-agent`.
- Reuse Node filesystem APIs for `stat`, `open`, `read`, and file size checks.
- Reuse Node's built-in test runner with fake timers or short polling intervals injected into the log stream service.

## APIs To Define Or Extend

Define WebSocket route:

- Upgrade only requests matching `/api/services/{service_name}/logs/stream`.
- Unknown service rejects the upgrade with an HTTP error or accepts then immediately sends an `error` and closes; prefer HTTP rejection for non-WebSocket clients and test clarity.
- Once connected, no file is open until an `open` message succeeds.

Define client message handling:

- `open`:
  - Requires `file` as a safe relative path and optional positive integer `tail_bytes`.
  - Resolve the file under `logs/<service_name>/`.
  - Reject absolute paths, `..`, path traversal after resolution, directories, and missing files.
  - Compute `start = max(0, file_size - tail_bytes)` and `end = file_size`.
  - Read and send exactly that byte range as `{ type: "chunk", file, start, end, text }`.
  - Store open file identity, current size, and current offset state for later messages.
- `read_before`:
  - Requires an open file.
  - Requires numeric `before` and optional positive integer `max_bytes`.
  - Compute `start = max(0, before - max_bytes)` and `end = min(before, current_file_size)`.
  - Send `{ type: "chunk", file, start, end, text }`.
  - Do not mutate the follow append offset.
- `follow`:
  - Requires an open file.
  - Enables or disables appended-byte checks.
  - When enabled, appended reads start at the last known file size from open or the latest append scan, not at zero.
- Unknown message types and malformed JSON send `{ type: "error", message }` without crashing the server.

Define server message handling:

- `chunk` and `append` messages use the exact shapes from the spec.
- `error` messages use `{ type: "error", message }`.
- For truncation or rotation, send a clear event. Because the spec only defines `chunk`, `append`, and `error`, use an `error` message such as `"log file was truncated or rotated; reopen the file"` and reset follow state so the client can send a new `open`.
- Text decoding should preserve byte offsets. Use `Buffer` slices and decode the sent range as UTF-8 for `text`; offsets remain byte offsets even if a range cuts through a multibyte character.
- Apply a sane maximum per read, defaulting to 65,536 bytes and clamping oversized client requests to avoid loading full large logs.

## Enabling Refactor

If `server.ts` currently owns all route logic, separate HTTP routing and WebSocket upgrade setup enough to keep the log stream testable. Do not replace the HTTP server with a larger framework solely for WebSocket support.

## Validation

- Unit tests cover safe file resolution for valid relative files, missing files, directories, absolute paths, `..`, and traversal through symlinks if symlinks are not intentionally supported.
- Byte-range tests cover initial tail reads, small files where `tail_bytes` exceeds size, zero-byte files, `read_before` ranges, and clamping oversized `max_bytes`.
- WebSocket tests cover:
  - opening a log file and receiving one bounded `chunk`
  - not sending the entire file when `tail_bytes` is smaller than file size
  - `read_before` chunk delivery with correct offsets
  - appended data delivery while follow is enabled
  - no appended delivery while follow is disabled
  - malformed/unknown messages returning `error`
  - truncation or rotation returning a clear event and allowing reopen
  - unknown service and unsafe file rejection
- `npm run build` and `npm test` pass in `projects/conductor`.

## Sequencing Notes

This slice depends on slice 0003. Slice 0005 should build the logs page against this WebSocket contract without adding a second log-reading API.
