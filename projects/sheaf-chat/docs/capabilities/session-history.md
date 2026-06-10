# Capability: Session History

ID prefix: `hist`

## Purpose

The per-session envelope log: how sequences are allocated, how pages are cut
(latest / before / after), and the REST history endpoint that lets clients
recover transcript state without a WebSocket. The same paging engine backs
the WebSocket `client.history_request` frame
([chat-protocol](chat-protocol.md)).

## Requirements

- **[hist-1]** THE service SHALL persist every server-side envelope for a
  session by appending `{"sequence": n, "envelope": {...}}` as one JSON line
  to `<sessionId>.sheaf-history.jsonl`
  ([format](../contracts/session-files.md)).
- **[hist-2]** THE service SHALL assign strictly increasing integer
  sequences per session, starting at 1. The first append after process start
  SHALL resume from the maximum of the manifest's `history.lastSequence` and
  the sequence of the last parseable line of the log file, so restarts never
  reuse sequence numbers.
- **[hist-3]** THE service SHALL serialize sequence allocation and append
  per session (in-process lock), so concurrent appends produce monotonic
  sequences without duplicates.
- **[hist-4]** WHEN an envelope is appended and the session's manifest
  exists, THE service SHALL update the manifest's `history.lastSequence` to
  the new sequence; IF no manifest exists yet, THEN the append SHALL succeed
  without one.
- **[hist-5]** IF an append is requested with an explicit sequence not
  greater than the latest, THEN THE service SHALL fail with
  `invalid_sequence` (`sequence <n> is not greater than latest <m>`) and
  write nothing.
- **[hist-6]** THE service SHALL page history with an effective limit of
  `min(floor(limit), 5000)`, defaulting to 50 when `limit` is absent,
  non-finite, or <= 0.
- **[hist-7]** WHEN no cursor is given, THE service SHALL return the
  `latest` page: the last `limit` entries, `hasMoreBefore` true when older
  entries exist, `hasMoreAfter` false.
- **[hist-8]** WHEN `before=<seq>` is given, THE service SHALL return the
  `before` page: the newest `limit` entries with sequence < `before`;
  `hasMoreBefore` reflects older remaining entries and `hasMoreAfter`
  reflects entries between the page and the cursor.
- **[hist-9]** WHEN `after=<seq>` is given, THE service SHALL return the
  `after` page: the oldest `limit` entries with sequence > `after`;
  `hasMoreAfter` reflects newer remaining entries and `hasMoreBefore` is
  false.
- **[hist-10]** IF both `before` and `after` are supplied, THEN THE service
  SHALL fail with 400 `invalid_history_request`
  (`history request cannot include both before and after cursors`).
- **[hist-11]** THE service SHALL serve
  `GET /api/piles/:pile/sessions/:sessionId/history` with query parameters
  `before`, `after`, `limit` (integers) and `prefer` (`events` |
  `snapshots`, REST default `events`), returning the page body in Contracts.
  Non-integer cursor/limit values and unknown `prefer` values fail 400
  `invalid_history_request`.
- **[hist-12]** WHEN `prefer=events`, THE response SHALL include both the
  extracted AGUI `events` (payloads of `agui.event` envelopes, in order) and
  the raw `envelopes`; WHEN `prefer=snapshots`, it SHALL include `messages`
  (the snapshot reduction of the page's AGUI events,
  [agui-mapping](agui-mapping.md)) and no `envelopes`.
- **[hist-13]** WHEN reading a page for a session with no history file, THE
  service SHALL return an empty page (`oldestSequence`/`newestSequence`
  null) rather than failing, provided the pile/session identifiers validate.

## Contracts

### `GET /api/piles/:pile/sessions/:sessionId/history`

| Parameter | Meaning |
|---|---|
| `before` | Return envelopes with sequence strictly below this cursor. |
| `after` | Return envelopes with sequence strictly above this cursor. |
| `limit` | Page size; default 50; capped at 5000. |
| `prefer` | `events` (default) or `snapshots`. |

Events response — 200:

```json
{
  "direction": "latest",
  "events": [ { "type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "user" } ],
  "envelopes": [ { "v": 1, "kind": "agui.event", "sequence": 2, "...": "..." } ],
  "oldestSequence": 1,
  "newestSequence": 12,
  "hasMoreBefore": false,
  "hasMoreAfter": false
}
```

Snapshots response (`prefer=snapshots`) — 200: same envelope-bound fields
with `messages` (AGUI snapshot messages) instead of `events`/`envelopes`.

`direction` is `latest`, `before`, or `after`. `oldestSequence` /
`newestSequence` are the page bounds (the `after`/`latest` directions fall
back to the log's newest sequence when the page is empty), or null on an
empty log.

### Error catalogue

| Condition | Status / code | Message |
|---|---|---|
| `before` and `after` together | 400 `invalid_history_request` | `history request cannot include both before and after cursors` |
| Non-integer `before`/`after`/`limit` | 400 `invalid_history_request` | `<label> must be an integer` |
| `prefer` not `events`/`snapshots` | 400 `invalid_history_request` | `prefer must be events or snapshots` |
| Explicit duplicate sequence on append | `invalid_sequence` (internal; 400 if surfaced) | `sequence <n> is not greater than latest <m>` |

## Design

- `src/storage/sessionLog.ts` — `AppendEnvelope` (per-session promise-chain
  lock, sequence cache, manifest update), `CollectSessionLogEntries`
  (streaming line reader, sorts by sequence),
  `ReadLatestSequenceFromHistoryTail` (reads the file tail in doubling
  chunks rather than the whole file).
- `src/storage/history.ts` — `ReadHistoryPage` and the three page builders;
  `x_defaultHistoryLimit = 50`, `x_maxHistoryLimit = 5000`.
- `src/server/routes/history.ts` — query parsing and the events/snapshots
  response split.
- The latest-sequence cache (`x_latestSequences`) is process-global and
  keyed by `pile\0sessionId`; external writers to the log file during
  process lifetime are not detected.
- Paging loads and sorts the full log in memory per request; there is no
  index.

## Interactions

- [session files](../contracts/session-files.md) — log entry and envelope
  formats.
- [chat-protocol](chat-protocol.md) — appends every persisted envelope here
  and serves `client.history_request` / replay from the same log.
- [agui-mapping](agui-mapping.md) — `eventsToSnapshots` for
  `prefer=snapshots`.
- [piles-sessions](piles-sessions.md) — the REST route shares pile/session
  validation.
