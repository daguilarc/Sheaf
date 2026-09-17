## 1. Remove the Pressure-Mapping Row Editor

- [ ] 1.1 Remove `MidiConfigViewModel`'s pressure-mapping entry points
      (`PressureMappingCount`, `PressureMappingFieldValue`,
      `AddPressureMapping`, `SetPressureMappingField`,
      `DeletePressureMapping`, the `PressureMappingField` enum) and
      `MirrorPressureMappingChangeIntoOpenSession`, and restore
      `SectionPresentation::hiddenPressureMappings`'s original comment
      (never rendered or edited; carried verbatim through a System Messages
      flush).
      Check: a build with every pressure-mapping symbol above deleted still
      links, and `SlotValidForKindValidatesPressureMappingsWithoutExposingANewKindSection`
      (`instrument_tests.cpp`, pre-existing and untouched by this task) still
      passes unmodified — it exercises `SlotValidForKind` directly and never
      called the removed entry points.
- [ ] 1.2 Remove the row's "Pressure mappings" node ids (`PressureMappings`,
      `PressureMappingsHeading`, `PressureMappingRow`, `PressureMappingField`,
      `PressureMappingDelete`, `PressureMappingAdd`), the
      `kPressureMappingFieldCommit`/`kPressureMappingDelete`/
      `kPressureMappingAdd` actions, their handlers, and the rendered
      `scroll.Column` block from `ControllersPageUI.hpp`.
      Check: `FindNodeById(surface.BuildTree(), NodeIds::PressureMappings(0))`
      returns `nullptr` for a row that, before this task, rendered a
      non-empty pressure-mapping list.
- [ ] 1.3 Remove the ten `TestPressureMapping*` functions
      (`TestPressureMappingShowsGridAttachedAndOrphanedThenEditCommits`,
      `TestPressureMappingAddAndDelete`,
      `TestPressureMappingAddStillSucceedsWhenNoteZeroIsTakenByPickingTheLowestFreeNote`,
      `TestPressureMappingAddedWhileSystemMessagesOpenSurvivesALaterGridAdd`,
      `TestPressureMappingEditedWhileSystemMessagesOpenSurvivesALaterGridAdd`,
      `TestPressureMappingXRefusesAWholeNumberOutsideIntRange`,
      `TestPressureMappingSlotXAndYReadAndWriteTheirOwnFieldNotAnother`,
      `TestPressureMappingFieldsRefuseChannelNoteSlotOutOfRangeAndNonNumericText`,
      `TestPressureMappingDeleteRemovesTheGivenIndexNotAlwaysFirst`,
      `TestPressureMappingShownOnEveryKindNotJustWrldBldr`) and their call
      sites from `controllers_page_ui_tests.cpp`.
      Check: the file, after this task, defines no function and contains no
      call whose name refers to a pressure mapping, and the rest of the file's
      tests still build and pass with those ten removed.
- [ ] 1.4 Confirm, by hand, on the harness or a JUCE build: a WRLD.Bldr row
      with a grid-attached pressure mapping still shows and edits that
      mapping inside the grid row's own cell, unchanged from before this
      change, and the row's expanded editor shows no "Pressure mappings"
      heading anywhere.
      Check: the six-state screenshot set in the proposal's Delivery Gate
      (state 6) shows this directly.

## 2. Test and Fix the Connect-Message Editor by Index

- [ ] 2.1 Add a test: a row holds two connect messages (`0xF0 0xF7` and a
      second, distinct valid message); committing a valid edit to message
      index 1 leaves message index 0's stored bytes unchanged and updates
      message index 1 to the edited bytes; the displayed field for index 0
      is unchanged and the field for index 1 shows the new text.
      Check: `harness.instrument.controllers[0].config.openSysEx[0]` equals
      its pre-edit value and `openSysEx[1]` equals the edited bytes, after
      dispatching `kConnectMessageCommit` with value `"0:1:<new hex>"`.
- [ ] 2.2 Add a test: committing an edit or a delete at a message index that
      does not exist (e.g. index 1 on a row holding one message) refuses,
      leaves every stored connect message unchanged, and sets a status
      starting with "Refused".
      Check: `harness.commits` is unchanged and
      `surface.StatusText().starts_with("Refused")` after dispatching
      `kConnectMessageCommit` or `kConnectMessageDelete` with value `"0:1"`
      (or `"0:1:<hex>"`) against a row holding exactly one message.
- [ ] 2.3 If either test in 2.1 or 2.2 fails against the current
      `HandleConnectMessageCommit`/`HandleConnectMessageDelete`/
      `SetConnectMessage`/`DeleteConnectMessage` path, fix the index handling
      there. If both pass at that layer, additionally build a JUCE harness
      screen with a row holding two connect messages, type into the second
      message's field, and confirm by inspection which message's stored
      bytes changed, before treating this task as done.

## 3. Widen the Device-Label Width Check

- [ ] 3.1 Add a case to `RunDeviceLabelWidthCheck` (or a neighboring test in
      `ControllersPageSimulationTests.cpp`) measuring, against
      `kControllerDeviceWidth` with the same `juce::GlyphArrangement`
      technique the existing library-name cases use: (a) frogg3rs's own
      longest real device display name, "Akai APC40 mkII (Ableton)" (from
      `app/FroggersMidiCatalog.hpp`, hardcoded as a literal here rather than
      imported, since Sheaf does not depend on any app), and (b)
      `StoredEndpointLabel`'s "name (identifier)" form for a representative
      bound, unresolved device at least as long as that name plus a typical
      CoreMIDI identifier string. Do not add a JUCE-linked test to frogg3rs's
      own `app/` for this: that tree's Controllers-page test binary is
      deliberately JUCE-free (`app/Makefile`'s `check_no_juce` target), so
      this measurement belongs in Sheaf, covering every app's names it can by
      literal, not by a cross-repo import.
      Check: both new cases' `Require(measured <= kControllerDeviceWidth, ...)`
      run and each failure message reports both measured and allowed widths,
      matching the existing cases' wording.
- [ ] 3.2 If either case added in 3.1 measures wider than
      `kControllerDeviceWidth`, widen the constant and re-derive the two
      `static_assert`s (`kActiveHeaderLine1Width <= kActiveHeaderLine2Width`,
      `kBlacklistedHeaderLine1Width <= kBlacklistedHeaderLine2Width`) that
      depend on it so both still hold at compile time.
- [ ] 3.3 If a future app's catalog adds a device display name longer than
      every case in 3.1, that app's own change is responsible for adding its
      own literal case here or widening `kControllerDeviceWidth`; this task
      does not add a mechanism that enumerates every downstream app's catalog
      automatically.

## 4. Fix the Browser E2E Spec's Device-Label Assertions

- [ ] 4.1 Fix the manually-added-record test's `.device` assertion, which
      still expects `TWISTER_KIND_LABEL`, to expect whatever
      `ControllerDeviceLabel` actually renders for a row with no resolved
      wizard id (the bound input's `StoredEndpointLabel`).
      Check: the test's `await expect(row.locator(synthNode("runtime.controllers.row.0.device")))`
      assertion names the label the row's own bound-input endpoint produces,
      not a kind string.
- [ ] 4.2 Update the manually-added-record test's add flow, which still uses
      the removed `runtime.controllers.add_name`/`add_kind`/`add_button`
      controls, to add through the current single Preset-combo add row (a
      Custom selection), and update every assertion downstream of that flow
      to match a Custom row's actual fields.
      Check: the test runs against controls the current page renders (no
      locator in it targets `add_name` or `add_kind`).
- [ ] 4.3 Record, without fixing here, in a comment beside the assertions
      this task touches: most of this suite's other failures predate this
      change, tracing to "Keep a renamed controller's row open," which
      removed `add_name`/`add_kind` and never enumerated every reference to
      them — a pre-existing break this task's two assertion fixes do not
      resolve and this change does not otherwise touch.
      Check: the comment names the removing commit; no assertion this task
      leaves untouched is claimed as fixed by this change.

## 5. Delivery

- [ ] 5.1 Capture and share the six Controllers-page screenshots named in the
      proposal's Delivery Gate for the operator's review before this merges
      to main.
