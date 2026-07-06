## ADDED Requirements

### Requirement: sru-19 — Launcher: app list and one-way selection
WHEN the Sheaf Patch superapp starts, THE runtime UI SHALL present a launcher page listing registered synth apps with their display name, author, category, and advisory hardware requirements, and SHALL start the selected app when the user activates an app row without blocking launch based on those requirements.

#### Scenario: Launcher lists registered apps
- **WHEN** the Sheaf Patch launcher opens
- **THEN** it lists every registered app sorted by stable app id
- **AND** each row shows the app display name, author, category, and minimum encoder requirement

#### Scenario: Selecting miniapp starts miniapp
- **WHEN** the user activates the miniapp row
- **THEN** the miniapp runtime starts
- **AND** the launcher no longer owns the visible main content for that process session

#### Scenario: No in-app return for this change
- **WHEN** a launched app is running
- **THEN** the runtime UI provides no launcher Back or Home action for returning to the app list
- **AND** returning to the launcher requires quitting and restarting the Sheaf Patch executable

#### Scenario: Category is visible
- **WHEN** the app list contains the current miniapp
- **THEN** the row shows category `test`

#### Scenario: Hardware requirements are advisory
- **WHEN** a registered app declares a minimum encoder requirement
- **THEN** the launcher displays that requirement
- **AND** activating the app row still starts the app regardless of detected hardware capability
