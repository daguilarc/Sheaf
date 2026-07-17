## Context

`MidiControlAddress` currently stores a channel and CC number and is reused by
encoder turns, encoder pushes, analog input, and channel/CC system-message
associations. The input processors already distinguish raw CC, note-on, and
note-off messages for Launchpad handling, but a profile cannot say that an
encoder push or Generic system-message address is a note.

The Controllers page already describes mapping rows through JUCE-free field
metadata and per-kind system-message address schemas. This change extends those
existing paths rather than adding a separate note editor or processor.

## Goals / Non-Goals

**Goals:**

- Represent CC versus note on affected input addresses with a small,
  backward-compatible model change.
- Match note-on with positive velocity as press and note-on with zero velocity
  or note-off as release.
- Let users select Note or CC on encoder push rows and Generic system-message
  rows while continuing to enter channel and number numerically.
- Preserve existing profiles and all CC-only defaults.

**Non-Goals:**

- Note-addressed encoder turns or analog inputs.
- Changing fixed WRLD.Bldr, MF Twister, or Launchpad system-message protocols.
- Musical note names, MIDI learn, or note-based output feedback.

## Decisions

### D1 — Type the existing control address

Add a two-value control message type (`cc` or `note`) to
`MidiControlAddress`, defaulting to CC. Keep the existing channel and numeric
member instead of introducing separate CC and note structs; both protocols have
the same `0..15` channel and `0..127` number domains, and the small enum keeps
matching, sorting, block expansion, and UI editing shared.

The existing numeric member and JSON number field need not be renamed as part
of this change. Renaming them would create broad mechanical churn unrelated to
the user-visible capability.

### D2 — Restrict note addresses through profile validation

The general address value can carry either type, but valid profile shapes
remain explicit:

- encoder turns and analog inputs are CC-only;
- encoder pushes may be CC or note;
- Generic system-message control addresses may be CC or note;
- controller-specific system-message address schemes retain their current
  protocol and validation.

Profile validation gains explicit address-type checks for encoder turns and
analogs as well as the per-kind system-message checks. This keeps one
address/matching primitive without accidentally expanding every MIDI input
feature.

### D3 — Share press/release classification

Input matching compares both message type and `(channel, number)`. For a
matching CC, a nonzero value is press and zero is release. For a matching note,
note-on with positive velocity is press; note-on with zero velocity and
note-off are release. Note-off status is authoritative even when the message
carries a nonzero release velocity.

Encoder push mappings emit `ParamPush` only for press, as they do today for CC;
release is recognized but emits no parameter command. Generic system-message
associations emit their configured press message and optional release message.
When a Generic system-message control is note-addressed, profile construction
does not create CC output feedback for it even if its existing output-feedback
flag is true. Note output feedback remains outside this change.

### D4 — Extend the existing row schema

Add one Note/CC address-type field to encoder push rows and Generic
system-message rows, including their block forms. Give it a distinct view-model
name rather than reusing the existing system-message-kind fields. The number
field remains a numeric editor and its short label can reflect the selected
type (`CC` or `Note`). Message type is part of address equality, canonical
ordering, and block coalescing, so a block never combines CC and note mappings.

### D5 — Make persistence backward compatible

Serialize the address message type in profile JSON. When it is absent, load CC,
which preserves all existing profile files and built-in defaults. Invalid note
placements are rejected by the same profile validation used after loading and
UI edits.

## Risks / Trade-offs

- [The existing numeric member is CC-named even for notes] → Keep the change
  small and present the value as a protocol-dependent number in the UI; a broad
  rename can be done separately if ever worthwhile.
- [A shared address type permits note values in unsupported sections in memory]
  → Validate section and controller-kind placement before commit or processor
  construction.
- [Mixed note and CC rows coalesce incorrectly] → Include message type in sort,
  equality, continuation, expansion, and round-trip tests.
- [A note-addressed system mapping emits legacy CC feedback] → Exclude note
  controls when building CC output associations and test that no output is sent.

## Migration Plan

No one-time migration is required. Existing JSON without a message type loads
as CC. Newly saved profiles include enough type information to reconstruct note
mappings. Rollback remains possible for profiles that contain only CC mappings;
older builds will not be expected to understand newly created note mappings.

## Open Questions

None.
