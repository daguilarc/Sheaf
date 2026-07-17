## Why

Absolute encoder feedback currently follows the post-modulation display value, so modulation animates the hardware ring and the next physical turn moves the parameter center from that animated position. Absolute input and output need a causal acknowledgement boundary and a modulation-free control-center value so hardware motion remains stable without echoing the just-received MIDI value.

## What Changes

- Tag every absolute encoder input with a monotonically increasing epoch and retain the latest expected epoch and received 7-bit value for its controller route.
- Publish each visible cell's normalized raw control center and processed absolute-input epoch atomically with the existing UI-state snapshot; the raw center includes scene and gesture distribution but excludes modulation, presentation conversion, and display smoothing.
- Add an engine-owned, thread-safe absolute-feedback coordinator shared by MIDI input and output processors. Absolute input establishes the expected epoch before queueing its parameter message; DSP acknowledges every handled or rejected absolute message; output withholds position feedback until the corresponding acknowledgement is visible.
- Give the coordinator 4096 fixed route records. Profile construction reserves tracked absolute routes within that bound; if a route cannot be reserved, its mapped absolute turns are consumed but not queued, failing closed instead of applying an event whose feedback cannot satisfy the causal contract.
- Suppress an exact echo of the received absolute value while still sending a correction when routing, modifiers, clamping, or other state leaves the acknowledged center at a different value. Queue insertion failure leaves no observable expectation or debounce change.
- Keep relative encoder output on the existing post-modulation display path and exclude relative input from epoch coordination.
- Give Generic controller profiles automatic plain position feedback when no explicit encoder output is configured: emit one debounced CC on each turn mapping's same input channel and CC, reuse absolute epoch coordination in Absolute mode, retain post-modulation feedback in relative modes, and emit no color, brightness, SysEx, or auxiliary traffic.
- Correct MF Twister feedback to match its manual: zero-based channel `0` is the sole primary encoder-value and LED-ring-position path; remove the erroneous channel `4` "indicator position" write because channel `4` is the shifted encoder/ring path. Retain channel `1` RGB color, channel `2` RGB brightness, and channel `5` primary ring brightness.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-parameter-modulation`: Add raw-center and epoch snapshot state, causal absolute-input acknowledgement and output suppression, relative-mode isolation, automatic plain Generic CC position feedback, and correct MF Twister primary-ring feedback channels.
- `synth-app-runtime`: Own and preserve the cross-thread absolute-feedback coordinator across controller processor rebuilds while maintaining the runtime's queue and thread-ownership contracts.

## Impact

This change depends on the implemented `add-absolute-encoder-mode` contract and its exact normalized raw-center projection. That earlier OpenSpec change remains the source-of-record dependency until it is separately synced or archived; this proposal does not archive it implicitly.

- `projects/synth/include/synth/ParameterModulation.hpp` and `projects/synth/src/ParameterModulation.cpp`: epoch-bearing absolute messages, acknowledgement routing, and coherent raw-center/epoch UI-state publication.
- `projects/synth/include/synth/MidiController.hpp` and `projects/synth/src/MidiController.cpp`: absolute-feedback coordination, input/output gating and debounce, Generic same-address CC output, profile construction, and removal of the incorrect Twister channel-4 output/cache field.
- `projects/synth/include/synth/Engine.hpp` and runtime assembly: coordinator ownership and processor rebuild wiring.
- `projects/synth/tests`: causal ordering, exact echo suppression, rejection correction, queue failure, rebuild and routing cases, relative-mode regressions, modulation-free absolute feedback, and manual-accurate Twister output coverage.
