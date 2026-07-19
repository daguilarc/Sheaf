Both questions verified. Findings:

## A) BROWSER COMMAND PROTOCOL — VERDICT: PROTOCOL UNCHANGED (safe)

The 64-bit gesture-mask widening does not cross the browser boundary.

- `git diff --stat main...HEAD` shows **zero** changes to any browser path: `projects/synth/include/synth/browser/` and `projects/synth/tests/browser_command_buffer_tests.cpp` are byte-identical to `main` (`git diff --name-only main...HEAD | grep -i browser` returns nothing).
- The wire schema in `/Users/joyo/.codex/worktrees/e1e8/Sheaf/projects/synth/include/synth/browser/BrowserCommandBuffer.hpp` carries only **rendered draw commands**, not gesture masks. `DecodedDrawCommand` (line 71) and `DecodedNode` (line 86) encode `CommandDrawKind`/`CommandNodeKind` enums (Fill, Arc, Text, FillRoundedRect, etc.) — no gesture/mask field of any width exists in the struct set. Grep for `gesture|mask|uint64` in the header returns no matches.
- Version constant is stable: `kCommandBufferVersion = 1` (line 22), written at line 480 and validated at line 503. Tests still assert `decoded.version == 1` (`browser_command_buffer_tests.cpp:87`) and `== kCommandBufferVersion` (lines 209, 270).
- The gesture mask is a purely UI-side snapshot field: `EncoderDraw.hpp:296` `synth::GestureMask gesturesAffectingMask`. It is consumed locally in `BuildEncoderDrawCommands` (line 693 `drawBadges`) to emit ordinary `Text`/`FillRoundedRect` draw commands — those rendered commands are what serialize, so widening the mask changes only how many badge draw commands are produced, never the wire layout.
- The review package corroborates: line 7381 records `git diff --exit-code ... projects/synth/browser projects/synth/tests/browser_command_buffer_tests.cpp: PASS; no browser format, version, payload, or command-buffer test change`.
- Portable UI test with a bit-63 gesture passes through snapshot → renderer and produces valid draw commands (`portable_ui_tests.cpp:442-459`), demonstrating the render path stays valid with 64-bit gestures.

## B) ENCODER BADGE LABELS 16..63 — VERDICT: CORRECT

Label-generation code, `/Users/joyo/.codex/worktrees/e1e8/Sheaf/projects/synth/include/synth/EncoderDraw.hpp:231-247`:

```cpp
inline std::string BadgeText(bool modulator, std::size_t index)
{
    if (modulator) { return "M" + std::to_string(index + 1); }
    if (index < 8) { return std::to_string(index + 1); }          // 0-7 -> "1".."8"
    static constexpr const char* x_Symbols[] = {"U","R","D","L","UU","RR","DD","LL"};
    if (index < 16) { return x_Symbols[index - 8]; }              // 8-15 -> directional
    return std::to_string(index + 1);                             // 16-63 -> "17".."64"
}
```

- Gestures 0-7: numeric `"1".."8"` (line 237-239). Correct.
- Gestures 8-15: directional symbols (line 241-245). Correct.
- Gestures 16-63: distinct one-based numeric `std::to_string(index + 1)` → index 16 → `"17"`, index 63 → `"64"` (line 246). No collision with the 1-8 range since those start at "17". Correct.

Index 63 is **explicitly tested** in `/Users/joyo/.codex/worktrees/e1e8/Sheaf/projects/synth/tests/portable_ui_tests.cpp`:
- Line 439: `BadgeText(false, 16) == "17"`
- Line 440: `BadgeText(false, 62) == "63"`
- Line 441: `BadgeText(false, 63) == "64"`
- Lines 442-459: full snapshot-to-render path — sets `gesturesAffectingMask = 1<<63`, builds draw commands, and asserts a `Text` command with `command.text == "64"` is emitted (`"encoder renders gesture 63 as badge 64"`).

Gesture 63 renders as "64" both at the unit-label level and through the full render pipeline.