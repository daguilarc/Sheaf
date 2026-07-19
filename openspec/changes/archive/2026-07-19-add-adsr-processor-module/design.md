## Context

The synth already separates JUCE-free DSP processors from modules that own
parameter registration and mapping. ADSR adds an envelope source at those same
two layers without choosing any application or modulation topology.

## Goals / Non-Goals

**Goals:**

- Provide a small, deterministic, single-voice ADSR state machine in natural
  per-sample units.
- Provide independent ADSR state for every `AdsrModule<Polyphony>` voice.
- Keep time mapping and parameter-system interaction in the module layer.

**Non-Goals:**

- No audio-amplitude, instrument, standard-modulator, UI, MIDI, controller,
  page, patch, or runtime integration.
- No delay, hold, loop, velocity, legato, or exponential segment curve modes.

## Decisions

- Use stage-progress interpolation rather than direct output slopes. Each
  active stage advances its own progress from zero to one, which makes the
  supplied increment define stage duration and permits exact endpoint clamping.
- Capture the current output on gate edges. A rising edge attacks from that
  value; a falling edge releases from it. This preserves continuity on
  retrigger and interruption.
- Keep DSP input in increments and sustain value. The module maps normalized
  controls to seconds and then computes `1 / (seconds * sampleRate)`.
- Use exponential controls only for knob-to-time mapping; attack, decay, and
  release outputs remain linear interpolations.
- Expose module output values but do not register them as modulation sources.
  A future composition change can choose how envelopes participate in a patch.

## Risks / Trade-offs

- [Float parameter times are not exact sample counts] → use double increments,
  clamp processor stage completion, and test mapping tolerances.
- [Live sustain changes affect an active decay target] → treat the parameter
  system's smoothing as the control-rate policy and keep sustain live.
- [Envelope integration could accidentally expand scope] → test and audit that
  no app, runtime, controller, patch, or standard-modulator source references
  the ADSR types.
