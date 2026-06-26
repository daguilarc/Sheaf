## Context

`ModulatorMetadata` already carries a display name, color, and connected flag. Lazily created depth parameters are created by `Bank::EnsureModulationDepthParameter`, but their metadata is currently derived from the parent parameter instead of the modulator. Disconnected `Parameter::UIState` cells already set color and indicator colors to `Off` and numeric values to zero, but the JUCE encoder still paints a grey controller body and MIDI output processors skip disconnected cells entirely.

## Decisions

1. **Add modulator short names.**
   `ModulatorMetadata` gains `shortName`, matching `ParameterConfig`. Existing callers are source-compatible because the field defaults empty.

2. **Lazy depth parameters inherit modulator display metadata.**
   When opening a modulation view and a depth parameter must be materialized for `modIx`, the created parameter uses the modulator's `name`, `shortName`, and `color`. Empty modulator name/shortName fields fall back to the current generated depth name and parent short name.

3. **Disconnected encoder cells do not draw controller chrome.**
   `EncoderComponent::paint` returns after loading a disconnected snapshot, and `UpdateDisplayFromState` clears segment text/colors for disconnected cells. Layout still reserves the component bounds so the grid keeps a visible empty space.

4. **Mapped disconnected MIDI output cells send an explicit blank state.**
   Twister output sends value `0`, color code `0`, and brightness `0`. Wrld.Bldr output sends value `0` plus button and indicator SysEx colors set to `Off`. Debounce caches this blank state so repeated processing does not spam hardware.

## Risks

- Existing manually assigned modulation-depth parameters keep their own metadata; this change only affects lazy materialization.
- Blanking disconnected hardware cells can send more output at bank/view changes, but debounce keeps repeated frames quiet.
