## Why

`8e56c779` ("Show which device each controller row is, and edit what a row
holds") shipped a controller row's device label (the preset's device name, or
the bound MIDI input when no preset resolves), a single Custom entry on the
add row, and connect-time SysEx message editing. In the same commit it also
shipped a row-level pressure-mapping editor, and its own commit message names
four things wrong with what it shipped: a pressure mapping owned by a grid row
reverts when its section is reopened; three refusal paths have no test that
fails; the device-label width check measures only the library's own fallback
names; and the browser e2e spec still asserts a label the row no longer shows.

This change keeps the device label, the Custom entry and connect-message
editing. It removes the pressure-mapping row editor rather than repair it —
grid-row editing already covers that ground and predates this work, so
repairing the row editor's reopen defect would be maintaining a second editor
for the same data. It closes the remaining test gaps and fixes what they find.

## What Changes

- **Remove the pressure-mapping row editor.** The row's "Pressure mappings"
  list, its Add/Delete/field-commit handlers and node ids, the
  `MidiConfigViewModel` entry points that back them (`PressureMappingCount`,
  `PressureMappingFieldValue`, `AddPressureMapping`, `SetPressureMappingField`,
  `DeletePressureMapping`, the `PressureMappingField` enum), the
  `MirrorPressureMappingChangeIntoOpenSession` open-section mirroring it
  needed, and its ten tests all go. A pressure mapping attached to a grid cell
  is edited by opening that grid row, exactly as before this work; a player
  opening a Controllers page row no longer sees a "Pressure mappings" list
  under it at all — only the row's ordinary sections. Deleting the editor also
  retires the section-reopen defect the shipped commit named unfixed: there is
  no row-level editor left to revert.
- **Test the connect-message editor by index, not just index zero.** Every
  existing connect-message test edits or deletes message 0 on a row holding
  exactly one message. Add coverage for a row holding two: editing message 1
  updates message 1 and leaves message 0 untouched; editing or deleting an
  out-of-range index refuses and leaves the instrument unchanged. Fix whatever
  this reveals in the handler/view-model path, or in the JUCE per-row editor
  wiring if the handler path already passes.
- **Widen the device-label width check's coverage.** `RunDeviceLabelWidthCheck`
  measures only `MakeControllerWizardRegistry(MidiAppCatalog{})`'s three
  library fallback names. Add a case measuring frogg3rs's own longest real
  device display name as a literal (Sheaf carries no dependency on any app,
  so this is a hardcoded string, not an import), and a case for
  `ControllerDeviceLabel`'s other path — `StoredEndpointLabel`'s "name
  (identifier)" form for a bound, unresolved row — using the same
  glyph-measurement technique. This stays inside Sheaf: frogg3rs's own
  Controllers-page test binary is deliberately JUCE-free, so it cannot host
  this kind of measurement itself.
- **Fix the browser e2e spec's device-label assertions.** The
  manually-added-record test still asserts the row's `.device` node reads the
  old kind-identity string (`TWISTER_KIND_LABEL`); fix it to expect what
  `ControllerDeviceLabel` actually renders for a row with no resolved wizard
  id, and update the add flow that test drives, which still uses the
  `add_name`/`add_kind` controls the page no longer has. Record, without
  fixing here: this suite fails ten of its seventeen tests since "Keep a
  renamed controller's row open" (`582e400a`, historically referenced as
  `c81727b9`) removed `add_name`/`add_kind` and never enumerated every
  reference to them — a pre-existing break this change's two assertion fixes
  do not resolve.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `synth-runtime-ui`: adds the requirement text for the row device label,
  the add row's Custom entry, and connect-time message editing that
  `8e56c779` shipped without any accompanying spec, and states that the row
  renders no pressure-mapping list. Nothing here was previously described by
  a promoted requirement, so this is additive text, not a behavior change.

## Impact

- `projects/synth/include/synth/ControllersPageUI.hpp`,
  `projects/synth/include/synth/MidiConfigViewModel.hpp`,
  `projects/synth/src/MidiConfigViewModel.cpp`: remove the pressure-mapping
  node ids, actions, handlers, view-model entry points and open-session
  mirroring.
- `projects/synth/tests/controllers_page_ui_tests.cpp`: remove the ten
  pressure-mapping tests and their call sites; add the two-message
  connect-message index tests.
- `projects/synth/juce/ControllersPageSimulationTests.cpp`: extend the
  device-label width check with the bound-device-label case.
- `projects/synth/browser/tests/fake-app.e2e.spec.ts`: fix the stale
  `.device` assertion and the add flow the manually-added-record test drives.
- Overlaps the pending, unarchived `rework-controllers-block-editing` change:
  its open-section edit-session model covers the same `SectionPresentation`/
  flush territory this change's pressure-mapping removal touches, and that
  change's own tasks 5 and 6.2/6.3 (model-based simulation, harness cleanup)
  are not done yet. Whichever change lands its `SectionPresentation` edit
  second should re-read the other's diff before touching
  `hiddenPressureMappings` or the flush path.
- Contradicts the pending, unarchived `app-midi-catalog` change's spec delta
  (requirement sru-62), which still specifies the row's kind label
  (`MidiProfileKindDisplayName`) and a "Custom (<device display name>)" entry
  per device kind on the add row's Preset combo. The device label and single
  Custom entry this change keeps already supersede that text in the shipped
  code; `app-midi-catalog`'s own delta needs reconciling to the device-label
  direction before it archives. This change does not edit `app-midi-catalog`'s
  delta — that reconciliation belongs to whoever archives it.

## Delivery Gate

Before this merges to main, the operator reviews screenshots of the
Controllers page in these states, taken from the harness or the app: (1) an
active row whose wizard id resolves, showing the preset's device name on line
one; (2) an active row with no resolved wizard id, showing its bound MIDI
input as the device label; (3) the add row's Preset dropdown open, listing
the app's own devices, one library device per uncovered kind, and one Custom
entry; (4) a row's expanded editor showing its Connect messages list with an
existing message, an Add button, and a delete button; (5) that same editor
after a malformed connect-message edit, showing the refusal status text; (6) a
row's expanded editor confirming no "Pressure mappings" list appears under
it, while a grid row's own pressure mapping still shows and edits inside that
grid row.
