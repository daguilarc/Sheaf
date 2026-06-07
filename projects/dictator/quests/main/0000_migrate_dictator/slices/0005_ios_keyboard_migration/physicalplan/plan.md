# Physical Plan: iOS Keyboard Migration

## Objective

Completely migrate the iOS keyboard app into `projects/dictator/`, update its endpoint behavior for the migrated Dictator service on port `9003`, keep source-of-truth Xcode project metadata, move tests into the project test area where practical, and omit all tracked/generated build output.

Expected outcome:

- iOS keyboard source and source-of-truth project metadata live under `projects/dictator/src/ios-keyboard/`.
- iOS tests live under `projects/dictator/tests/ios-keyboard/`, with the Xcode project updated to reference those paths.
- Default service URL uses port `9003`.
- Host app, keyboard extension, shared config, app group/session behavior, Darwin notifications, transcript insertion tracking, diagnostics, endpoint configuration, and Xcode build/test integration are preserved.
- `projects/dictator/` contains no `build/` output from the external iOS app.

## Key Files And Systems

Likely new files:

- `projects/dictator/src/ios-keyboard/README.md`
- `projects/dictator/src/ios-keyboard/XCODE_SETUP.md`
- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj/**`
- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardExtension/**`
- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost/Assets.xcassets/**`
- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/HostApp/**`
- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/HostInfo.plist`
- `projects/dictator/src/ios-keyboard/Shared/**`
- `projects/dictator/tests/ios-keyboard/DictatorKeyboardHostTests/**`
- `projects/dictator/tests/ios-keyboard/DictatorKeyboardHostUITests/**`

Likely files to update:

- `projects/dictator/.gitignore`
- `projects/dictator/Makefile`
- `projects/dictator/docs/reference/api.md`
- `projects/dictator/docs/reference/testing.md`
- `projects/dictator/docs/explanation/architecture.md`

External source files to migrate:

- `apps/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj/project.pbxproj`
- `apps/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj/project.xcworkspace/contents.xcworkspacedata`
- `apps/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardExtension/KeyboardViewController.swift`
- `apps/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardExtension/Info.plist`
- `apps/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardExtension/KeyboardExtension.entitlements`
- `apps/ios-keyboard/DictatorKeyboardHost/HostApp/DictatorKeyboardHostApp.swift`
- `apps/ios-keyboard/DictatorKeyboardHost/HostApp/HostAppRootView.swift`
- `apps/ios-keyboard/DictatorKeyboardHost/HostApp/HostApp.entitlements`
- `apps/ios-keyboard/DictatorKeyboardHost/HostInfo.plist`
- `apps/ios-keyboard/Shared/SharedConfig.swift`
- `apps/ios-keyboard/Shared/DarwinNotificationCenter.swift`
- `apps/ios-keyboard/Shared/DictatorKeyboardExtension.txt`
- assets under `DictatorKeyboardHost/DictatorKeyboardHost/Assets.xcassets/**`
- tests under `DictatorKeyboardHostTests/**` and `DictatorKeyboardHostUITests/**`.

Do not migrate:

- `apps/ios-keyboard/DictatorKeyboardHost/build/**`, including tracked `.app`, `.appex`, `.swiftmodule`, `.xctest`, `XCBuildData`, object files, framework copies, dependency info, and temporary `*.swiftdeps~`.

## Existing APIs To Reuse As-Is

- Reuse keyboard session state types:
  - `KeyboardSessionPhase`
  - `SharedKeyboardSession`
  - `SharedConfig` session persistence helpers.
- Reuse Darwin notification behavior:
  - `dictation.start`
  - `dictation.stop`
  - `dictation.cancel-take`
  - `session-updated`.
- Reuse host app upload behavior targeting `POST /v1/dictate-audio`.
- Reuse UIInputViewController keyboard behavior for launching host app, start/stop/cancel, transcript insertion, shift, space, return, and delete.
- Reuse local diagnostics file behavior and remove the old Conductor remote trace lookup/posting path from active iOS code, because the migrated Dictator service does not expose that service-manager trace API.

## APIs To Extend Or Modify

- Change `SharedConfig.fallbackServerURL` from the external LAN/old port value to a Sheaf-compatible default on port `9003`, for example `http://127.0.0.1:9003` for simulator/local docs, with host app UI allowing users to enter a reachable Mac LAN address using port `9003`.
- Change all visible endpoint examples such as `http://host:8787` to port `9003`.
- Update `Info.plist` default server URL values from `8787` to `9003`.
- Ensure the host app builds the dictation endpoint as `/v1/dictate-audio`, not duplicate path segments.
- Preserve request headers:
  - `Content-Type: audio/wav`
  - `X-Sample-Rate: 16000` or actual captured sample rate
  - `X-Locale`
  - `X-Session-Id`
  - optional context/style headers where available
  - `X-Request-Id`.
- Update iOS response decoding to match the migrated response fields from slice 3.
- Replace tests that currently assume Conductor trace port `9000` or `/services` trace lookup with tests for local diagnostics persistence and the configured Dictator service/web UI endpoint.
- Add tests that prove endpoint defaults and configured overrides use port `9003`.

## Implementation Notes

The Xcode project remains under `src/ios-keyboard/DictatorKeyboardHost/` because it is source-of-truth project metadata, not build output. Move tests to `projects/dictator/tests/ios-keyboard/` and update the `.pbxproj` to reference those files with relative paths.

Project Makefile additions:

- `ios-build`: run `xcodebuild -project src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj -scheme DictatorKeyboardHost -sdk iphonesimulator -derivedDataPath .build/xcode CODE_SIGNING_ALLOWED=NO build`
- `ios-test`: same project/scheme with `test` when a simulator destination is available
- `build`: include Swift service build plus iOS build, or document a separate iOS target if full iOS build requires local Xcode/simulator constraints
- `test`: include Swift tests plus iOS tests where the local environment supports them.

Use `.build/xcode` or another project-local generated path for DerivedData and remove it in `clean`.

Before running `xcodebuild`, verify `projects/dictator/.gitignore` from slice 1 covers the actual Xcode output path selected by this slice. If the chosen DerivedData/build path differs from `.build/xcode` or emits additional file classes, extend the project-local `.gitignore` in this slice before running the build. The expected ignored Xcode outputs include `.build/xcode/**`, any nested `build/**`, `.app`, `.appex`, `.xctest`, `.swiftmodule`, `.swiftdoc`, `.swiftsourceinfo`, `.abi.json`, object files, dependency files, hmaps, and `XCBuildData`.

Docs should make clear that an iPhone device cannot reach `127.0.0.1` on the Mac; users must set the host app endpoint to the Mac LAN address with port `9003`.

## Validation

- `make -C projects/dictator ios-build`
- `make -C projects/dictator ios-test` when simulator support is available
- `make -C projects/dictator test`
- `git check-ignore projects/dictator/.build/xcode projects/dictator/src/ios-keyboard/DictatorKeyboardHost/build/Debug-iphonesimulator/example.app projects/dictator/src/ios-keyboard/DictatorKeyboardHost/build/Debug-iphonesimulator/example.xctest`
- `git status --short projects/dictator` after iOS build/test should show no generated Xcode artifacts.
- Focused iOS tests for:
  - default server URL uses port `9003`
  - configured server URL overrides default
  - dictation upload targets `/v1/dictate-audio`
  - required request headers are set
  - migrated response shape decodes
  - session launch/update/failure/completion persistence
  - stale launch reconciliation
  - transcript insertion tracking
  - Darwin notification state transitions
  - local diagnostics behavior.
- Static checks:
  - `git ls-files projects/dictator | rg "(/build/|\\.swiftdeps~$|\\.app/|\\.appex/|\\.xctest/|\\.swiftmodule$|\\.swiftdoc$|\\.swiftsourceinfo$|\\.abi\\.json$)"`
  - `rg "8787|192\\.168\\.1\\.56|/v1/transcribe|/v1/refine|conductorPort = 9000|/services\\?name=dictator|/trace" projects/dictator/src/ios-keyboard projects/dictator/tests/ios-keyboard`
