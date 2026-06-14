## MODIFIED Requirements

### Requirement: lp-22 — Hunk controls: Provider routing

WHEN a Launchpad hunk-control button is pressed, THE Launchpad controller SHALL route the matching navigation, stage, revert, or undo command to the healthy focused hunk review target selected by Dictator; IF no healthy focused hunk review target reports the action available, THEN the controller SHALL consume the button without sending a keyboard fallback.

#### Scenario: Sheaf Chat hunk target focused

- **WHEN** Sheaf Chat Agent Review Mode is the healthy focused hunk review target and a lit hunk-control button is pressed
- **THEN** Dictator sends the matching hunk command to the Sheaf Chat provider

#### Scenario: No commandable hunk target

- **WHEN** no healthy focused hunk review target reports the button's action available
- **THEN** Dictator sends no hunk command and no keyboard command

## REMOVED Requirements

### Requirement: lp-18 — VS Code hunk-control static layout reservation
**Reason**: The VS Code hunk-control layer is being deleted.
**Migration**: Do not reserve `(0,2)` through `(3,3)` for VS Code hunk controls; any remaining hunk-control ownership must be described by provider-neutral Launchpad behavior.
