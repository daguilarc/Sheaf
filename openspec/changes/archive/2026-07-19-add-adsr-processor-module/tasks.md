## 1. ADSR DSP processor

- [x] 1.1 Add the JUCE-free `AdsrProcessor` state machine with increment,
  sustain, and gate input.
- [x] 1.2 Add focused DSP tests for stages, endpoint completion, held stages,
  interruption, and current-value retriggering.

## 2. Polyphonic ADSR module

- [x] 2.1 Add `AdsrModule<Polyphony>` with ADSR parameter registration, bank
  mapping, natural-unit mapping, per-voice processing, and stable outputs.
- [x] 2.2 Add focused module tests for mapping ranges, defaults, independent
  voices, lifecycle errors, sample-rate changes, and bank order.

## 3. Verification and scope

- [x] 3.1 Add precise build dependencies for the DSP header.
- [x] 3.2 Run focused DSP and module tests, the complete synth suite, and the
  no-integration scope audit.
