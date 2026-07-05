## Context

The Controllers page persists controller profiles as ordinary arrays of encoder
mappings, analog mappings, and system-message associations. Blocks are a
presentation convenience: a deterministic coalescing pass can show a uniform
run as one editable row, and a block can expand back to the existing persisted
arrays without changing the JSON/profile format.

The current implementation tries to keep block rows stable by re-resolving row
identities against the normalized config after rebuilds. That is too subtle for
the interaction model we need. Edits, adds, deletes, focus changes, and live
runtime rebuilds all pull on the same identity/reconstruction machinery, so a
button click can change persisted state without immediately changing the
rendered session rows, or can require an extra button press before the UI
refreshes. Scrolling also regressed because the portable tree currently
conflates the scroll area's visible bounds with the content extent the backend
must make reachable.

## Goals / Non-Goals

**Goals:**

- Make the persisted profile arrays the only saved source of truth.
- Make each open controller section own an explicit in-memory edit-session row
  list that is what the UI renders until the section closes.
- Keep coalescing and expanding as pure, JUCE-free boundaries that are simple
  to test independently.
- Flush accepted session changes to the persisted config without re-coalescing
  the currently visible rows.
- Fix scrolling by separating viewport geometry from scroll content extent in
  the portable UI tree and JUCE backend.
- Add deterministic model-based simulation tests that can explore the
  Controllers page state machine and replay failures by seed.

**Non-Goals:**

- Persisting blocks or changing the profile JSON format.
- Redesigning the entire Controllers page visual language in this change.
- Changing MIDI processor semantics, hardware routing, patch load behavior, or
  audio runtime behavior.
- Supporting a browser backend in this change; the abstractions should remain
  browser-compatible, but implementation remains JUCE plus headless tests.

## Decisions

### D1 — Open sections render session rows, not reconstructed config

Each expanded `(controller identity, section)` owns a `ControllerConfigEditSession`
entry. Opening a section reads the current persisted profile arrays, normalizes
a scratch view, coalesces that view into rows, and stores those rows in the
session. `SectionRows()` renders only the stored session rows while the section
is open.

This replaces the identity re-resolution approach for ordinary edit flow. The
session row list is not rebuilt from the persisted arrays after every commit.
If the user wants fresh minimal grouping, they close and reopen the section.

Alternative considered: keep the current identity re-resolution cache and patch
the broken cases. That keeps too many moving parts: row identity, block
structure, persisted ordering, and renderer refresh timing all remain coupled.

### D2 — Flush is expand, normalize, commit

Accepted edits mutate the target session row first. The view model then expands
the current session rows for that section back to the persisted element arrays,
normalizes those arrays with the existing canonical ordering rules, validates
the slot, and returns the committed `MidiInstrumentConfig` to the host edit
path.

The normalized persisted arrays are allowed to sort differently from the open
session rows. That is the point: persistence remains canonical, while the UI
remains stable. A later close/reopen coalesces from the canonical arrays and may
show a different, more compact grouping.

### D3 — Adds append to the active session group

"+" and "+B" create a singleton or block row using the same next-free default
rules as the current implementation, then append that row to the end of the
requested group in the session row list. After appending, the whole open
session is flushed to the persisted profile arrays.

The add operation must not call reconstruct/coalesce to decide where the new row
belongs, because that would let a newly added row merge with a neighboring row
while the user is still inside the section.

### D4 — Deletes remove session rows exactly

Delete removes the targeted singleton row or block row from the session, then
flushes the remaining rows. Config-level rows remain non-deletable. The delete
operation is intentionally row-based, not identity-reconstruction-based: deleting
a displayed block removes the cells represented by that displayed block, and
nothing else.

### D5 — Pure block functions stay small and testable

The existing block reconstruction and expansion ideas remain valid, but the
implementation should draw a harder boundary:

- `Coalesce*ToSessionRows(...)` turns normalized persisted elements into
  presentation rows only on open.
- `ExpandSessionRowsTo*Config(...)` turns session rows into persisted arrays on
  flush.
- `NormalizeMidiProfileConfig(...)` canonicalizes persisted order only after
  expansion and before returning the config to the host.

Those functions must not depend on JUCE, renderer nodes, or live runtime state.

### D6 — Scroll areas carry two sizes

Portable UI scroll nodes need both visible viewport bounds and content extent.
The JUCE renderer should set the viewport component bounds from the visible
bounds and set the child content size from the content extent. Browser or DOM
backends can map the same data to scroll containers without guessing which
height is visible and which height is scrollable.

### D7 — Testing uses an independent oracle

The simulation test must not just click whatever visible actions exist and
assert "no crash." It should carry a small oracle model of controller sections:
open/closed state, session rows, and persisted arrays. Each generated action
updates the oracle and the implementation. After every step, the test compares:

- implementation session rows vs oracle session rows,
- persisted instrument profile arrays vs oracle expansion normalized,
- rendered tree rows/actions vs session rows,
- scroll content extent and bottom reachability when content exceeds viewport.

Seeds must be printed on failure and accepted as a command-line or environment
override so a failing random walk is replayable.

### D8 — System message editors split kind from arguments

The system-message UI should not use a dropdown catalog that bakes semantic
arguments into labels. A row whose press message is `SceneSelect(3)` should have
a message-kind control set to "Scene Select" and a separate scene-index field
set to `3`. Bank select similarly separates message kind from slot/bank
arguments, and gesture select separates message kind from gesture index.

This means the view model needs field metadata for message kind and for the
argument fields relevant to that kind. The renderer should receive semantic
controls, not preformatted "message plus argument" option labels. Block rows
already use blockable message type plus start argument; singleton rows should
follow the same mental model.

### D9 — System-message editing is one pipeline with per-kind address schemas

WRLD.Bldr, Launchpad, Twister, and Generic system-message configuration should
share one implementation for message kind fields, argument fields, row/block
coalescing, expansion, validation orchestration, add/delete/edit, and session
flush. The only kind-specific surface is the address schema:

- WRLD.Bldr: channel, x, y.
- Launchpad: x, y.
- MF Twister: logical side button.
- Generic: channel, cc.

This should be represented as data and helper functions consumed by the shared
pipeline. Avoid separate renderer or view-model branches that each hand-build a
different system-message editor.

## Risks / Trade-offs

- [Patch load or out-of-band instrument replacement while a section is open]
  -> Rebuild should preserve the open session only when the same controller
  still exists and the host accepts edits against the current instrument. If the
  controller/kind/section is incompatible, discard that section session and
  force a fresh open rather than silently mixing unrelated rows.
- [Session rows drift from external persisted changes] -> This is acceptable
  for ordinary in-page edits because the session is the visible editing
  surface. Runtime patch loads are an explicit external replacement and can
  invalidate affected sessions.
- [Expanded flush duplicates or collides] -> Expansion validates the whole
  candidate section before commit; refused edits leave both the session and the
  persisted config unchanged.
- [Large controller configs make full-section flush expensive] -> Controller
  mapping arrays are small enough for simple full-section expansion to be
  clearer and safer than incremental persistence patches.
- [Simulation tests become flaky] -> Tests use deterministic seeds, fixed action
  budgets, and explicit invariants. A failing seed is promoted to a named
  regression test before changing behavior.

## Migration Plan

1. Add focused failing tests that capture the current regressions: scrolling to
   the bottom of a large section, add/delete/edit not requiring a second click,
   and no regrouping while a section stays open.
2. Introduce the edit-session model and pure coalesce/expand helpers alongside
   the current view model paths.
3. Move `SectionRows`, add, edit, and delete to session rows; remove stale
   identity re-resolution code once tests pass.
4. Fix the portable scroll node contract and JUCE viewport/content sizing.
5. Split singleton system-message kind controls from argument fields and add
   row/block tests that reject catalog labels such as "Scene Select 3".
6. Consolidate system-message editor code so all controller kinds use the same
   row/block/session pipeline with address schema as the variation point.
7. Replace broad smoke-style simulation with oracle-driven simulation and
   promote any discovered seeds to named regression tests.
8. Keep the standalone controllers harness wired to the production view model
   so visual iteration exercises the same state machine as tests.

## Open Questions

None blocking. The implementation may choose exact type names and file splits,
but the open-section session boundary, flush semantics, and simulation oracle
are required.
