## Context

Absolute encoder input currently normalizes a 7-bit CC byte linearly as `B / 127`, and absolute output linearly quantizes normalized raw knob state. Because the 128-value MIDI domain has no exact center, byte `64` maps above `0.5`. `ParamSetAbsolute` and parameter state already operate in normalized float space, while the absolute-feedback coordinator retains the received MIDI byte for causal acknowledgement.

## Goals / Non-Goals

**Goals:**

- Make absolute MIDI byte `64` select normalized parameter value `0.5` exactly while preserving `0 -> 0` and `127 -> 1`.
- Keep `ParamSetAbsolute` expressed as a normalized parameter-space float.
- Make output the inverse of input and keep acknowledgement/debounce in the final 7-bit byte domain.
- Implement the three related edits and focused tests as one task.

**Non-Goals:**

- Changing relative encoders, analog MIDI mappings, parameter storage, UI display values, MIDI profiles, or `turnStep`.
- Changing epoch coordination, queue behavior, or debounce policy.

## Decisions

1. **Use a fixed power curve at the absolute MIDI boundary.** Let
   `a = log(0.5) / log(64 / 127) ≈ 1.011444814893185`. Absolute input byte `B` becomes the normalized float `pow(B / 127, a)`. This is the smallest monotonic endpoint-preserving curve that satisfies `f(64) = 0.5`. Curving parameter state instead would affect non-MIDI edits; special-casing byte `64` would introduce a discontinuity.

2. **Apply the mathematical inverse before output quantization.** For normalized raw knob position `x`, absolute output computes `pow(clamp(x, 0, 1), 1 / a)` and then uses the existing nearest-byte quantization. The inverse exponent is approximately `0.988684686772166`. Shared named constants/helpers should keep the two directions numerically paired.

3. **Separate parameter values from transport bytes.** `ParamSetAbsolute` carries the curved float target in `[0, 1]`; the raw received byte remains only in absolute-feedback coordination. Output acknowledgement, correction, and debounce compare/cache the inverse-curved and quantized `uint8_t`, so the existing MIDI-domain behavior remains intact.

## Risks / Trade-offs

- **Floating-point round-trip near quantization boundaries** → Test every input byte through forward conversion followed by inverse conversion and require recovery of the original 7-bit byte after rounding.
- **Accidentally curving other normalized MIDI controls** → Keep helpers on the absolute encoder branches only and retain relative/analog regression coverage.
- **Input and output constants drifting apart** → Derive the inverse from the same exponent constant rather than maintaining unrelated literals.
