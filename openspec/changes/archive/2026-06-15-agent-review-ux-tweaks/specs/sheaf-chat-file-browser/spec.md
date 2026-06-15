## ADDED Requirements

### Requirement: fb-28 — Browser workspace: active tab kept visible

WHEN the selected file tab changes or the file tab bar re-renders on the non-touch layout, THE Sheaf Chat UI SHALL horizontally scroll the tab bar so the selected tab is visible.

#### Scenario: Selecting a tab scrolled out of view

- **WHEN** the user selects a file tab that is outside the visible region of the horizontal tab bar
- **THEN** the UI scrolls the tab bar so that the selected tab is visible

#### Scenario: Active tab kept visible on re-render

- **WHEN** the file tab bar re-renders while the selected tab would be outside the visible region
- **THEN** the UI scrolls the tab bar so that the selected tab is visible
