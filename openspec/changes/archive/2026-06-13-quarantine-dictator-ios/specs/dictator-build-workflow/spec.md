## ADDED Requirements

### Requirement: dbw-1 — Default build excludes iOS
WHEN Dictator's regular build workflow is invoked, THE Dictator project SHALL build the Swift package service/core targets without invoking the iOS app, keyboard extension, `xcodebuild`, `ios-build`, an `iphonesimulator` SDK, or the `DictatorKeyboardHost.xcodeproj` project.

#### Scenario: Project build invoked
- **WHEN** `make -C projects/dictator build` is invoked
- **THEN** the command builds the Swift package targets
- **AND** it does not invoke the iOS build lane or Xcode project

#### Scenario: Root build shortcut invoked
- **WHEN** `make dictator-build` is invoked from the repository root
- **THEN** it delegates to the Dictator regular build workflow
- **AND** it does not invoke the iOS build lane or Xcode project

### Requirement: dbw-2 — Default test excludes iOS simulator
WHEN Dictator's regular test workflow is invoked, THE Dictator project SHALL run Swift package tests without invoking iOS simulator tests, `ios-test`, `xcodebuild`, an `iPhone 16` simulator destination, or the `DictatorKeyboardHost.xcodeproj` project.

#### Scenario: Project test invoked
- **WHEN** `make -C projects/dictator test` is invoked
- **THEN** the command runs Swift package tests
- **AND** it does not invoke the iOS simulator test lane

#### Scenario: Root test shortcut invoked
- **WHEN** `make dictator-test` is invoked from the repository root
- **THEN** it delegates to the Dictator regular test workflow
- **AND** it does not invoke the iOS simulator test lane

### Requirement: dbw-3 — Opt-in iOS validation remains available
WHEN a developer explicitly invokes Dictator's iOS validation lanes, THE Dictator project SHALL keep opt-in commands for building and testing the retained iOS host app and keyboard extension from the existing Xcode project.

#### Scenario: iOS build explicitly invoked
- **WHEN** `make -C projects/dictator ios-build` is invoked
- **THEN** the command targets `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj`
- **AND** it uses the `DictatorKeyboardHost` scheme as a manual iOS build check

#### Scenario: iOS test explicitly invoked
- **WHEN** `make -C projects/dictator ios-test` is invoked
- **THEN** the command targets `src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj`
- **AND** it uses the `DictatorKeyboardHost` scheme as a manual iOS simulator test check

### Requirement: dbw-4 — Operations docs identify quarantine boundaries
WHEN Dictator build and test procedures are documented, THE documentation SHALL identify Swift package build/test commands as the default validation path and iOS build/test commands as opt-in quarantined/manual checks.

#### Scenario: Operations documentation read
- **WHEN** a developer reads Dictator operations or README build/test instructions
- **THEN** the documented default build and test commands exclude iOS validation
- **AND** the documented iOS commands are presented as opt-in quarantined/manual checks
