# Portable JUCE Value Actions Design

## Goal

Make every value-producing control in the generic JUCE portable backend obey the same action-value contract as the browser backend, and prove that a real Controllers device selection persists through the production portable surface and renderer.

## Root Cause

Portable actions may carry an address prefix in `Action::value`. The browser backend appends a control's emitted value to that prefix, separated by `:`. The generic JUCE backend instead replaces the prefix for combo boxes, sliders, and text fields, and emits no state for toggles. Controllers endpoint, variant, and mapping actions therefore arrive without the controller/section/row/field address required by `ControllersPageSurface` and are ignored or misapplied.

The Controllers-specific JUCE renderer formerly performed this composition correctly. The regression became user-visible when that renderer was removed and Controllers migrated to the generic `PortableComponent`.

## Interaction Contract

- Buttons dispatch their declared action unchanged.
- Combo boxes, text fields, toggles, and sliders append their emitted value to the declared action value: an empty declared value becomes `value`; a non-empty declared value becomes `prefix:value`.
- Pointer-drag actions retain their existing replacement-delta contract and are outside this change.
- JUCE text fields commit once per completed edit. Return commits and releases focus; the resulting focus loss must not dispatch the same unchanged edit again.
- Programmatic refreshes remain notification-free.

## Testing

The JUCE backend test will exercise actual retained JUCE widgets and their production callbacks, not direct surface dispatch. It will cover prefixed combo, text, toggle, and slider actions and the text-field single-commit rule.

The Controllers simulation test will render the real `ControllersPageSurface` through the production `PortableComponent`, select an enumerated endpoint through the actual `juce::ComboBox`, refresh, and assert that the committed instrument and rendered selection both retain the chosen endpoint.

These tests intentionally fail against the current implementation and are reviewed before production code changes. The existing real-WASM Playwright endpoint-selection test remains the browser acceptance proof; browser production code is unchanged.

## Scope

Only the generic JUCE value-action composition and its focused regressions change. There is no Controllers-specific production branch, popup automation, layout change, browser behavior change, or unrelated refactor.
