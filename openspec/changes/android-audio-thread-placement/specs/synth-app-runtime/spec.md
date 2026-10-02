# Delta — `synth-app-runtime`

## ADDED Requirements

### Requirement: sar-44 — Android: the audio thread runs on the faster cores
WHEN the JUCE runtime runs on Android on a device whose cores do not all share one maximum frequency, THE runtime SHALL, the first time each audio thread runs its audio callback, restrict that thread to the cores whose maximum frequency is above the slowest core's, SHALL determine those cores off the audio thread, and SHALL leave placement to Android when fewer than two distinct maximum frequencies can be read, skipping any core whose frequency cannot be read.

#### Scenario: A phone with slow and fast cores
- **WHEN** the runtime starts audio on a Galaxy S20 FE (cores 0-3 at 1.8 GHz, 4-7 faster)
- **THEN** the audio thread runs on cores 4-7 and, with the transport stopped and the default patch loaded, the DSP meter reads under 100%
- Check: operator step — pending.

#### Scenario: Uniform cores
- **WHEN** every core reports the same maximum frequency
- **THEN** the runtime does not change the audio thread's placement
- Check: operator step — pending (Android emulator, whose cores share one frequency).
