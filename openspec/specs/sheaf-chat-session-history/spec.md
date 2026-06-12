# Capability: Session History

Project: `projects/sheaf-chat`
ID prefix: `hist` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The per-session envelope log: how sequences are allocated, how pages are cut
(latest / before / after), and the REST history endpoint that lets clients
recover transcript state without a WebSocket. The same paging engine backs
the WebSocket `client.history_request` frame
([chat-protocol](../sheaf-chat-chat-protocol/spec.md)).

## Requirements

### Requirement: hist-1 — Persist server-side envelopes

THE service SHALL persist every server-side envelope for a session by appending `{"sequence": n, "envelope": {...}}` as one JSON line to `<sessionId>.sheaf-history.jsonl` ([format](../../../projects/sheaf-chat/docs/contracts/session-files.md)).

#### Scenario: Envelope appended

- **WHEN** a server-side envelope is produced for a session
- **THEN** `{"sequence": n, "envelope": {...}}` is appended as one JSON line to `<sessionId>.sheaf-history.jsonl`

### Requirement: hist-2 — Strictly increasing sequences starting at 1

THE service SHALL assign strictly increasing integer sequences per session, starting at 1. The first append after process start SHALL resume from the maximum of the manifest's `history.lastSequence` and the sequence of the last parseable line of the log file, so restarts never reuse sequence numbers.

#### Scenario: First append in a fresh session

- **WHEN** the first envelope is appended to a new session
- **THEN** it receives sequence 1

#### Scenario: Process restart resume

- **WHEN** a process restarts and the first append occurs
- **THEN** the sequence resumes from the maximum of the manifest's `history.lastSequence` and the last parseable line's sequence, never reusing a number

### Requirement: hist-3 — Serialized sequence allocation per session

THE service SHALL serialize sequence allocation and append per session (in-process lock), so concurrent appends produce monotonic sequences without duplicates.

#### Scenario: Concurrent appends

- **WHEN** multiple concurrent appends are requested for the same session
- **THEN** sequences are assigned monotonically without duplicates

### Requirement: hist-4 — Manifest update on append

WHEN an envelope is appended and the session's manifest exists, THE service SHALL update the manifest's `history.lastSequence` to the new sequence; IF no manifest exists yet, THEN the append SHALL succeed without one.

#### Scenario: Manifest exists on append

- **WHEN** an envelope is appended and the session's manifest exists
- **THEN** the manifest's `history.lastSequence` is updated to the new sequence

#### Scenario: No manifest on append

- **WHEN** an envelope is appended and no manifest exists yet
- **THEN** the append succeeds without a manifest

### Requirement: hist-5 — Reject explicit duplicate or non-advancing sequence

IF an append is requested with an explicit sequence not greater than the latest, THEN THE service SHALL fail with `invalid_sequence` (`sequence <n> is not greater than latest <m>`) and write nothing.

#### Scenario: Duplicate or out-of-order explicit sequence

- **WHEN** an append is requested with an explicit sequence not greater than the latest
- **THEN** the service fails with `invalid_sequence` (`sequence <n> is not greater than latest <m>`) and writes nothing

### Requirement: hist-6 — Effective page limit

THE service SHALL page history with an effective limit of `min(floor(limit), 5000)`, defaulting to 50 when `limit` is absent, non-finite, or <= 0.

#### Scenario: Limit absent or invalid

- **WHEN** `limit` is absent, non-finite, or <= 0
- **THEN** the effective limit is 50

#### Scenario: Limit provided

- **WHEN** `limit` is provided as a positive finite integer
- **THEN** the effective limit is `min(floor(limit), 5000)`

### Requirement: hist-7 — Latest page when no cursor

WHEN no cursor is given, THE service SHALL return the `latest` page: the last `limit` entries, `hasMoreBefore` true when older entries exist, `hasMoreAfter` false.

#### Scenario: No cursor given

- **WHEN** no `before` or `after` cursor is given
- **THEN** the service returns the last `limit` entries with `hasMoreBefore` true when older entries exist and `hasMoreAfter` false

### Requirement: hist-8 — Before page

WHEN `before=<seq>` is given, THE service SHALL return the `before` page: the newest `limit` entries with sequence < `before`; `hasMoreBefore` reflects older remaining entries and `hasMoreAfter` reflects entries between the page and the cursor.

#### Scenario: Before cursor given

- **WHEN** `before=<seq>` is given
- **THEN** the service returns the newest `limit` entries with sequence < `before`, with `hasMoreBefore` reflecting older remaining entries and `hasMoreAfter` reflecting entries between the page and the cursor

### Requirement: hist-9 — After page

WHEN `after=<seq>` is given, THE service SHALL return the `after` page: the oldest `limit` entries with sequence > `after`; `hasMoreAfter` reflects newer remaining entries and `hasMoreBefore` is false.

#### Scenario: After cursor given

- **WHEN** `after=<seq>` is given
- **THEN** the service returns the oldest `limit` entries with sequence > `after`, with `hasMoreAfter` reflecting newer remaining entries and `hasMoreBefore` false

### Requirement: hist-10 — Reject both cursors

IF both `before` and `after` are supplied, THEN THE service SHALL fail with 400 `invalid_history_request` (`history request cannot include both before and after cursors`).

#### Scenario: Both before and after supplied

- **WHEN** both `before` and `after` are supplied in the same request
- **THEN** the service fails with 400 `invalid_history_request` (`history request cannot include both before and after cursors`)

### Requirement: hist-11 — History REST endpoint

THE service SHALL serve `GET /api/piles/:pile/sessions/:sessionId/history` with query parameters `before`, `after`, `limit` (integers) and `prefer` (`events` | `snapshots`, REST default `events`), returning the page body in Contracts. Non-integer cursor/limit values and unknown `prefer` values fail 400 `invalid_history_request`.

#### Scenario: Valid history request

- **WHEN** `GET /api/piles/:pile/sessions/:sessionId/history` is called with valid parameters
- **THEN** the service returns the page body as defined in Contracts

#### Scenario: Non-integer cursor or limit

- **WHEN** `before`, `after`, or `limit` is non-integer
- **THEN** the service fails with 400 `invalid_history_request`

#### Scenario: Unknown prefer value

- **WHEN** `prefer` is not `events` or `snapshots`
- **THEN** the service fails with 400 `invalid_history_request`

### Requirement: hist-12 — Events vs snapshots prefer modes

WHEN `prefer=events`, THE response SHALL include both the extracted AGUI `events` (payloads of `agui.event` envelopes, in order) and the raw `envelopes`; WHEN `prefer=snapshots`, it SHALL include `messages` (the snapshot reduction of the page's AGUI events, [agui-mapping](../sheaf-chat-agui-mapping/spec.md)) and no `envelopes`.

#### Scenario: prefer=events

- **WHEN** `prefer=events` is specified (or omitted, defaulting to events)
- **THEN** the response includes both the extracted AGUI `events` and the raw `envelopes`

#### Scenario: prefer=snapshots

- **WHEN** `prefer=snapshots` is specified
- **THEN** the response includes `messages` (snapshot reduction of the page's AGUI events) and no `envelopes`

### Requirement: hist-13 — Empty page for missing history file

WHEN reading a page for a session with no history file, THE service SHALL return an empty page (`oldestSequence`/`newestSequence` null) rather than failing, provided the pile/session identifiers validate.

#### Scenario: No history file exists

- **WHEN** a history page is requested for a session with no history file
- **THEN** the service returns an empty page with `oldestSequence` and `newestSequence` null

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

- [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md) — log entry and envelope
  formats.
- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — appends every persisted envelope here
  and serves `client.history_request` / replay from the same log.
- [agui-mapping](../sheaf-chat-agui-mapping/spec.md) — `eventsToSnapshots` for
  `prefer=snapshots`.
- [piles-sessions](../sheaf-chat-piles-sessions/spec.md) — the REST route shares pile/session
  validation.
