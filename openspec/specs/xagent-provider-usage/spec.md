# Capability: Provider Usage

Project: `projects/xagent`
ID prefix: `usage` — requirement IDs are append-only; never renumber or reuse.

## Purpose

`projects/xagent/utils/provider_usage.py` prints one JSON object describing
current Claude, Codex, and Cursor usage. Callers use it as a small status
probe (dashboards, agents, scripts). Usage is always a filled-bucket fraction:
`0.0` empty, `1.0` exhausted. Provider-specific raw responses are retained
under each provider's `payload` field.

## Requirements

### Requirement: usage-1 — CLI output: JSON on stdout

WHEN the script is executed as a program, THE script SHALL write a single JSON
object to stdout and exit 0 on a completed collection attempt (individual
provider failures are represented inside the object, not as a non-zero exit).

#### Scenario: Normal run
- **WHEN** `python3 projects/xagent/utils/provider_usage.py` is run
- **THEN** stdout is one JSON object and the process exit code is 0

### Requirement: usage-2 — Top-level shape: provider blocks

THE JSON object SHALL contain exactly the top-level keys `claude`, `codex`,
and `cursor`, each mapping to an object.

#### Scenario: Keys present
- **WHEN** collection finishes
- **THEN** the object has `claude`, `codex`, and `cursor` objects

### Requirement: usage-3 — Usage scale: filled-bucket fraction

WHERE a usage field is present, THE value SHALL be a float in `[0.0, 1.0]`
meaning fraction of the quota already consumed (`0.0` empty, `1.0` full),
independent of whether the upstream provider reported "used" or "remaining".

#### Scenario: Percent used reported
- **WHEN** a provider reports `N% used` or `usedPercent: N`
- **THEN** the emitted usage field is `N / 100` clamped to `[0.0, 1.0]`

#### Scenario: Percent remaining reported
- **WHEN** Claude prose reports `N% remaining` / `left` / `available`
- **THEN** the emitted usage field is `1.0 - N/100` clamped to `[0.0, 1.0]`

### Requirement: usage-4 — Timestamps: ISO-8601 with offset

WHERE a reset-time field is present, THE value SHALL be an ISO-8601 timestamp
string including a numeric UTC offset (local wall time for Claude's stated
timezone; local offset derived from Unix epoch for Codex/Cursor).

#### Scenario: Reset time parsed
- **WHEN** a provider reset time is successfully parsed
- **THEN** the corresponding `*_resets_at` field is an ISO-8601 offset datetime

### Requirement: usage-5 — Partial success: omit failed fields

IF a usage or reset field cannot be fetched or parsed, THEN THE script SHALL
omit that expected field from the provider object and SHALL still emit the
rest of the report.

#### Scenario: One field fails
- **WHEN** a single field fails to parse
- **THEN** that field is absent and sibling fields remain

### Requirement: usage-6 — Payload retention: always include provider payload

THE script SHALL include a `payload` field on every provider object: the raw
provider response when fetch succeeds, or `{"error": "<message>"}` when the
provider fetch itself fails.

#### Scenario: Provider fetch succeeds
- **WHEN** a provider returns data
- **THEN** that provider object's `payload` is the full raw response
  (Claude: usage report text string; Codex/Cursor: JSON object)

#### Scenario: Provider fetch fails
- **WHEN** a provider fetch raises
- **THEN** that provider object's `payload` is `{"error": "<message>"}` and
  parsed usage/reset fields for that provider are omitted

### Requirement: usage-7 — Claude: session and week windows

THE `claude` object SHALL, when parseable from `claude -p '/usage'` text,
include:

- `five_hour_usage` / `five_hour_resets_at` from the line labeled
  `Current session`
- `week_usage` / `week_resets_at` from the line labeled
  `Current week (all models)`

Parsing SHALL locate those labels case-insensitively at line start, then parse
percent and `resets <Month> <D> at <h>:<mm><am|pm> (<IANA tz>)` from the
remainder of the same line.

#### Scenario: Standard Claude report
- **WHEN** the Claude report contains
  `Current session: 42% used · resets Jul 26 at 1:10pm (America/Los_Angeles)`
  and
  `Current week (all models): 81% used · resets Jul 27 at 11:59am (America/Los_Angeles)`
- **THEN** `five_hour_usage` is `0.42`, `week_usage` is `0.81`, and both
  reset fields are ISO timestamps in `America/Los_Angeles`

### Requirement: usage-8 — Codex: main weekly window

THE `codex` object SHALL, when present in `account/rateLimits/read` via
`codex app-server`, take the main bucket from
`rateLimitsByLimitId.codex.primary` (falling back to top-level
`rateLimits.primary`) and emit:

- `week_usage` from `usedPercent`
- `week_resets_at` from `resetsAt` (Unix seconds)

#### Scenario: Main codex bucket present
- **WHEN** `rateLimitsByLimitId.codex.primary.usedPercent` is `97` and
  `resetsAt` is a Unix timestamp
- **THEN** `week_usage` is `0.97` and `week_resets_at` is that instant as ISO

### Requirement: usage-9 — Cursor: all-models and cursor-models windows

THE `cursor` object SHALL, when present in
`DashboardService/GetCurrentPeriodUsage` (authenticated with the Keychain
`cursor-access-token`), emit:

- `all_models_usage` from `planUsage.totalPercentUsed`
- `cursor_models_usage` from `planUsage.autoPercentUsed`
- `all_models_resets_at` / `cursor_models_resets_at` from `billingCycleEnd`
  (Unix milliseconds), each only when the matching usage field was emitted

Cursor percent fields are UI percentage points (e.g. `0.95` ≈ "1% used");
THE script SHALL convert with `/ 100` before clamping.

#### Scenario: Cursor period usage present
- **WHEN** `autoPercentUsed` is `0.95`, `totalPercentUsed` is `0.84`, and
  `billingCycleEnd` is set
- **THEN** `cursor_models_usage` is about `0.0095`, `all_models_usage` is
  about `0.0084`, and both reset fields equal the billing cycle end as ISO

## Contracts

### Output schema (informative)

```json
{
  "claude": {
    "five_hour_usage": 0.0,
    "five_hour_resets_at": "2026-07-26T13:10:00-07:00",
    "week_usage": 0.0,
    "week_resets_at": "2026-07-27T11:59:00-07:00",
    "payload": "<string | {error}>"
  },
  "codex": {
    "week_usage": 0.0,
    "week_resets_at": "2026-08-01T12:43:23-07:00",
    "payload": { }
  },
  "cursor": {
    "all_models_usage": 0.0,
    "all_models_resets_at": "2026-08-01T22:50:25-07:00",
    "cursor_models_usage": 0.0,
    "cursor_models_resets_at": "2026-08-01T22:50:25-07:00",
    "payload": { }
  }
}
```

All usage/reset keys except `payload` are optional per usage-5 / usage-6.

### Implementation

- Script: `projects/xagent/utils/provider_usage.py`
- Claude: `claude -p '/usage'`
- Codex: `codex app-server` JSON-RPC `account/rateLimits/read`
- Cursor: Keychain `cursor-access-token` →
  `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
