# Launchpad MIDI Endpoint Selection Design

## Goal

Make Dictator connect to the standard MIDI ports of the first available configured Launchpad Pro Mk3 or Mini Mk3 preference and never select the device's DAW ports.

## Current behavior

Each controller profile currently matches only the model-specific substring (`launchpad pro` or `launchpad mini`). CoreMIDI enumerates the connected Mini's DAW endpoints before its MIDI endpoints, so the first-match scan selects `LPMiniMK3 DAW Out` and `LPMiniMK3 DAW In`.

The earlier Pro-only implementation used the same first-match strategy for every endpoint containing `launchpad pro`; it did not deliberately distinguish MIDI from DAW.

## Approved behavior

Endpoint matching remains case-insensitive and model-specific, and also requires the standard MIDI endpoint rather than the DAW endpoint. CoreMIDI's source and destination collections provide direction; the endpoint display names do not have to include `In` or `Out`. With the default preference list, Dictator tries Pro Mk3 first and Mini Mk3 second on every reconnect scan:

- A source must contain the candidate model substring and `midi`, and must not contain `daw`.
- A destination must contain the candidate model substring and `midi`, and must not contain `daw`.
- An endpoint containing the candidate model substring but only a DAW role does not match.
- A CoreMIDI endpoint marked offline does not match, even if it belongs to a higher-priority preferred model.
- If either required MIDI endpoint is absent, Dictator tries the next configured model.
- If no configured model has a usable endpoint pair, Dictator refreshes its CoreMIDI client/ports and retries discovery once before publishing `searching`, keeping hot-swap recovery independent from a service restart.

This rule applies identically to the Pro Mk3 and Mini Mk3 profiles. The connected profile supplies the SysEx model byte (`0x0E` for Pro, `0x0D` for Mini); all pad behavior remains unchanged.

## Implementation

Extend `LaunchpadTransportProfile` with a standard-MIDI endpoint predicate. Make source and destination scans evaluate the ordered profile list and use the same predicate against the respective CoreMIDI endpoint collections rather than the current model-only matcher.

Keep the matching logic pure so tests can provide endpoint names without requiring CoreMIDI hardware.

## Testing and specification

Add regression tests that enumerate a matching DAW endpoint before a matching MIDI endpoint and prove that the standard `MIDI` endpoint is accepted while DAW is rejected. Cover both supported models, case-insensitivity, missing MIDI endpoints, and rejection of the other model.

Update OpenSpec requirement `lp-27` and its scenarios to make the MIDI-only source/destination contract and no-DAW-fallback behavior explicit. Hardware smoke evidence must report the connected MIDI source name before the pending manual pad and sleep/wake checks are marked complete.
