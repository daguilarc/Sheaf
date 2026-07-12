## Why

Sheaf Patch needs a first instrument that exercises heterogeneous parameter polyphony, audio-rate self-modulation, reusable matrix routing, and a dense 16-encoder portable UI as one coherent synth. Braid 4 provides that proving ground while adding reusable oscillator-bank and bipolar matrix-mixer building blocks to the synth library.

## What Changes

- Add the reusable `Braid4VcoModule` four-oscillator wavetable module—with a future `Braid4LfoModule` sibling anticipated—using per-oscillator quad controls, monophonic PM-index and base-frequency controls, raw oscillator outputs, separable equal-power stereo XY placement, scope-holder UI state, and caller-controlled colors/frequency shifts for audible and LFO reuse.
- Add a reusable size-templated bipolar matrix-mixer module whose zero-based exponential gain parameters default to an identity matrix and whose parameters share Braid's monophonic group.
- Add reusable allocation-free fixed-factor oversampled-output and streaming FIR-decimator classes suitable for the steady-state audio thread.
- Add a JUCE-free Braid 4 synth application core with three parameter groups, two manager-global scenes, one 16-encoder slot, a Braid parameter bank, a matrix bank, a parameter/DSP/modulation clock running at exactly four times the negotiated host rate (192 kHz for the preferred 48 kHz host rate), final-stage anti-aliased 4:1 stereo downsampling, patch-compatible parameter state, and a portable UI surface.
- Add vertically stacked audible-VCO and LFO 2x2 waveform visualizers plus a 4x4 encoder grid to the Braid 4 main screen.
- Register Braid 4 with stable app id `braid-4` so Sheaf Patch can launch it; no standalone Braid 4 executable is required.
- Add module, headless app, portable UI, launcher-registration, and build coverage.

## Capabilities

### New Capabilities

- `synth-braid-4`: Product behavior, parameter topology, audio/modulation graph, stereo mixing, and testable application contract for the Braid 4 synth.

### Modified Capabilities

- `synth-modules`: Add reusable Braid 4 VCO-bank and size-templated bipolar matrix-mixer module contracts.
- `synth-dsp-classes`: Add reusable allocation-free fixed-factor oversampled-output and streaming FIR-decimator contracts.
- `synth-parameter-modulation`: Add rate-conversion helpers and safe pre-audio reconfiguration of parameter-group processing timing without changing group topology.
- `synth-app-runtime`: Add Braid 4 as a typed Sheaf Patch application registration without requiring a standalone target.
- `synth-runtime-ui`: Add the Braid 4 portable main-screen contract with eight independent waveform scopes and sixteen encoder controls.

## Impact

- Synth library: `projects/synth/include/synth/Modules.hpp`, `projects/synth/include/synth/DspBuffers.hpp`, and their tests gain two reusable module templates plus a streaming FIR decimator; no new external dependency is introduced.
- Parameter system: group processing alphas and target cadence become safely reconfigurable during prepare/device changes while parameter topology and storage remain fixed.
- Synth app: a new JUCE-free app directory under `projects/synth/apps/braid-4` supplies the core, portable UI, draw model, and registration.
- Sheaf Patch: the launcher app list, build dependencies, and launcher harness include the Braid 4 registration.
- Build/tests: the synth Makefile gains Braid-specific JUCE-free system/UI test coverage and the Sheaf Patch target compiles the new app headers.
- Persistence: Braid 4 uses the existing shared Sheaf Patch runtime configuration and app-specific `patches/braid-4` path policy.
- Runtime audio: Braid continues to prefer 48 kHz but derives its internal clock from the host's actual negotiated rate, so existing sample-rate negotiation remains unchanged.
