## 1. Workflow Targets

- [x] 1.1 Update `projects/dictator/Makefile` so `build` runs the Swift package build only and no longer depends on `ios-build`.
- [x] 1.2 Update `projects/dictator/Makefile` so `test` runs Swift package tests only and no longer depends on `ios-test`.
- [x] 1.3 Keep `ios-build` and `ios-test` available as explicit opt-in targets using the existing Xcode project and scheme.
- [x] 1.4 Verify root `make dictator-build` and `make dictator-test` inherit the Swift-only default behavior through existing forwarding.

## 2. Documentation

- [x] 2.1 Update `projects/dictator/README.md` to describe Dictator as a macOS/service workflow and list Swift-only default build/test commands.
- [x] 2.2 Update `projects/dictator/docs/operations.md` so default validation excludes iOS and iOS build/test commands are labeled quarantined/manual opt-in checks.
- [x] 2.3 Update `projects/dictator/docs/README.md` and `projects/dictator/docs/architecture.md` to describe the iOS client as retained/quarantined rather than active by default.
- [x] 2.4 Update coverage or related docs if they still imply iOS simulator validation is part of normal Dictator testing.

## 3. Tests

- [x] 3.1 Add or update a lightweight test that pins `projects/dictator/Makefile` default `build` and `test` dependencies without invoking Xcode.
- [x] 3.2 Add or update a lightweight test that confirms the opt-in `ios-build` and `ios-test` targets still exist.
- [x] 3.3 Ensure any existing migration or hygiene tests still allow retained iOS source/tests while excluding generated Xcode artifacts.

## 4. Validation

- [x] 4.1 Run `make -C projects/dictator build` and confirm it does not invoke Xcode.
- [x] 4.2 Run `make -C projects/dictator test` and confirm it does not invoke iOS simulator tests.
- [x] 4.3 Run `make dictator-build` and `make dictator-test` from the repo root if practical.
- [x] 4.4 Do not run `ios-build` or `ios-test` as part of default validation; only run them if explicitly doing a manual quarantine check.
