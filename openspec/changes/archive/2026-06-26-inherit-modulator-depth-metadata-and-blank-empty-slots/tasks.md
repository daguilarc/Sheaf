## 1. Modulator Metadata

- [x] 1.1 Add `shortName` to `ModulatorMetadata` and update metadata tests.
- [x] 1.2 Make lazily created modulation-depth parameters inherit modulator name, short name, and color with sensible fallbacks.
- [x] 1.3 Add tests for inherited lazy depth metadata.

## 2. Empty Slot Blanking

- [x] 2.1 Make disconnected encoder cells render as empty space in the JUCE encoder component.
- [x] 2.2 Make Twister output send debounced value/color/brightness blank feedback for disconnected mapped cells.
- [x] 2.3 Make Wrld.Bldr output send debounced value/off-color SysEx blank feedback for disconnected mapped cells.
- [x] 2.4 Add core MIDI output tests for disconnected-cell blanking and debounce.

## 3. Verification

- [x] 3.1 Run `make -C projects/synth test`.
- [x] 3.2 Run `make -C projects/synth miniapp`.
- [x] 3.3 Run `make -C projects/synth/miniapp test`.
- [x] 3.4 Run `openspec validate inherit-modulator-depth-metadata-and-blank-empty-slots` and mark tasks complete.
