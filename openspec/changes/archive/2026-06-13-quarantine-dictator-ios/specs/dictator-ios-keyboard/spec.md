## ADDED Requirements

### Requirement: ios-11 — Quarantined retained client
WHILE the iOS keyboard client is quarantined, THE Dictator project SHALL retain the iOS host app, keyboard extension, shared code, tests, Xcode project metadata, and setup notes in the repository for possible future reactivation, but SHALL NOT include that code in default Dictator build or test validation.

#### Scenario: Default Dictator validation runs
- **WHEN** the default Dictator build or test workflow runs
- **THEN** the iOS host app and keyboard extension are not built or tested

#### Scenario: iOS source inspected
- **WHEN** a developer inspects `projects/dictator/src/ios-keyboard/`
- **THEN** the retained host app, keyboard extension, shared code, Xcode project, and setup notes remain available

#### Scenario: iOS tests inspected
- **WHEN** a developer inspects `projects/dictator/tests/ios-keyboard/`
- **THEN** the retained iOS unit and UI test sources remain available

#### Scenario: iOS validation requested explicitly
- **WHEN** a developer intentionally runs the opt-in iOS validation commands
- **THEN** the project can still attempt to build or test the retained iOS client through the Xcode project
