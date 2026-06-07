# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T00:00:00Z
- updated_at: 2026-06-07T00:00:00Z
- title: Xcode test folder references use wrong relative path (off by one ../)
- details: |
  The Xcode project at
  `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj/project.pbxproj`
  references the migrated test folders with an off-by-one relative path.

  What is wrong:
  - The two `PBXFileSystemSynchronizedRootGroup` entries for the test targets use
    four `../` levels:
    - `DictatorKeyboardHostTests`: `path = ../../../../tests/ios-keyboard/DictatorKeyboardHostTests`
      (project.pbxproj:101)
    - `DictatorKeyboardHostUITests`: `path = ../../../../tests/ios-keyboard/DictatorKeyboardHostUITests`
      (project.pbxproj:106)
  - These paths resolve relative to SRCROOT (the directory containing the
    `.xcodeproj`): `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/`.
  - Four `../` levels resolve to `projects/tests/ios-keyboard/...`, which does not
    exist. The actual tests live at `projects/dictator/tests/ios-keyboard/...`.
  - Verified on disk: `projects/tests` is MISSING;
    `projects/dictator/tests/ios-keyboard/DictatorKeyboardHostTests` EXISTS.

  Why three `../` is the correct count:
  - The `Shared` PBXGroup (project.pbxproj:192) uses `path = ../Shared` with
    `sourceTree = SOURCE_ROOT` and correctly resolves to
    `projects/dictator/src/ios-keyboard/Shared` with a single `../`. This confirms
    the resolution base is the `DictatorKeyboardHost/` directory.
  - From that base, reaching `projects/dictator` requires exactly three `../`
    (DictatorKeyboardHost -> ios-keyboard -> src -> dictator), so the correct test
    path is `../../../tests/ios-keyboard/<dir>`.

  Why it is a problem:
  - The slice plan (slices/0005_ios_keyboard_migration/physicalplan/plan.md,
    Implementation Notes, line 93) requires the `.pbxproj` to reference the
    relocated tests with correct relative paths.
  - With the wrong path, the synchronized test groups point at a non-existent
    folder, so `make ios-test` (xcodebuild test) cannot find/compile the
    `DictatorKeyboardHostTests` and `DictatorKeyboardHostUITests` sources. The
    migrated iOS unit and UI tests would therefore not run.
  - This slipped through because `make ios-build` builds only the app/extension
    build action (not the test targets), and `make ios-test` was blocked by
    simulator unavailability in the implementer environment
    (implementation_done.md:23), so the broken folder reference was never
    exercised.

  What must be true to mark this issue completed:
  - Both test `PBXFileSystemSynchronizedRootGroup` `path` values use three `../`
    (`../../../tests/ios-keyboard/DictatorKeyboardHostTests` and
    `../../../tests/ios-keyboard/DictatorKeyboardHostUITests`), resolving to the
    existing `projects/dictator/tests/ios-keyboard/...` directories.
  - The resolved paths exist relative to the `.xcodeproj` directory.
- resolution_notes: none
