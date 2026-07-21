# Launchpad MIDI Endpoint Selection Design

## Goal

Make Dictator connect to the standard MIDI ports of a configured Launchpad Pro Mk3 or Mini Mk3 and never select the device's DAW ports.

## Current behavior

Each controller profile currently matches only the model-specific substring (`launchpad pro` or `launchpad mini`). CoreMIDI enumerates the connected Mini's DAW endpoints before its MIDI endpoints, so the first-match scan selects `LPMiniMK3 DAW Out` and `LPMiniMK3 DAW In`.

The earlier Pro-only implementation used the same first-match strategy for every endpoint containing `launchpad pro`; it did not deliberately distinguish MIDI from DAW.

## Approved behavior

Endpoint matching remains case-insensitive and model-specific, and also requires the endpoint's role:

- A source must contain the selected model substring and `midi out`.
- A destination must contain the selected model substring and `midi in`.
- An endpoint containing the selected model substring but only a DAW role does not match.
- If either required MIDI endpoint is absent, Dictator remains searching and does not fall back to DAW or another Launchpad model.

This rule applies identically to the Pro Mk3 and Mini Mk3 profiles. SysEx model-byte selection and all pad behavior remain unchanged.

## Implementation

Extend `LaunchpadTransportProfile` with source and destination endpoint-role substrings. Make source and destination scans call role-specific matchers rather than the current model-only matcher.

Keep the matching logic pure so tests can provide endpoint names without requiring CoreMIDI hardware.

## Testing and specification

Add regression tests that enumerate a matching DAW endpoint before a matching MIDI endpoint and prove that only `MIDI Out` is accepted as a source and only `MIDI In` is accepted as a destination. Cover both supported models, case-insensitivity, missing MIDI endpoints, and rejection of the other model.

Update OpenSpec requirement `lp-27` and its scenarios to make the MIDI-only source/destination contract and no-DAW-fallback behavior explicit. Hardware smoke evidence must report the connected MIDI source name before the pending manual pad and sleep/wake checks are marked complete.
