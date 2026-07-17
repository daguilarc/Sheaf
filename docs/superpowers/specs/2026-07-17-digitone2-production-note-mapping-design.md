# Digitone 2 Production Note Mapping Design

## Scope

Update only the `digitone2` Generic controller in the production Sheaf Patch
runtime configuration at
`~/Library/Sheaf/synth/sheaf-patch/config`. Preserve its device endpoints,
absolute encoder-turn mappings, and every other controller.

## Encoder Pushes

Replace the existing channel-1 CC push addresses with zero-based MIDI channel
`0` note addresses. Positions `0` through `15` use these MIDI note numbers in
order:

```text
68, 69, 70, 71, 60, 61, 62, 63,
72, 73, 74, 75, 64, 65, 66, 67
```

These are the MIDI Monitor notes G#3, A3, A#3, B3, C3, C#3, D3, D#3,
C4, C#4, D4, D#4, E3, F3, F#3, and G3 using its `C3 = 60`
convention.

## System Messages

Add zero-based channel `0` note-addressed Generic system controls:

- MIDI `84` (C5): hold Reset while pressed.
- MIDI `85` (C#5): hold Random while pressed.
- MIDI `86` (D5): hold Random Modulation while pressed.
- MIDI `92` through `99` (G#5 through D#6): select parameter banks `0`
  through `7`, respectively.

Modifier note-on enables the modifier and note-off disables it. Bank selectors
act on note-on only. These note-addressed controls request no output feedback.

## Safety and Verification

Before mutation, require the production application to be stopped and create a
timestamped sibling backup. Apply the update atomically, then verify:

- the file parses as JSON;
- exactly one controller named `digitone2` exists and remains Generic;
- its 16 push mappings have the exact channel, type, number, slot, position,
  and order above;
- it has exactly the three modifier and eight bank-selector system mappings;
- its encoder turns and endpoints are unchanged;
- all non-Digitone controllers are byte-equivalent as parsed JSON;
- the production runtime can load the resulting configuration using the
  repository's current parser/validation path.
