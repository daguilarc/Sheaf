## MODIFIED Requirements

### Requirement: spm-12 — Edits: HandleIncDec scene and gesture distribution
WHEN `Parameter::HandleIncDec(delta)` is called, THE parameter SHALL apply the delta to the active scene center value when blend is at one scene endpoint and no gesture distribution is active, SHALL distribute the delta across the two active scene center values when blend is between scenes using the Smart Grid scene distribution formula, SHALL treat the first turn for any selected inactive gesture as an arming turn that activates the gesture for the touched scene endpoints and snapshots each touched parent scene value into the matching gesture value without applying the delta, and SHALL distribute non-arming turns between active gesture values and base scene values according to Smart Grid-style effective gesture weights regardless of current gesture selection.

#### Scenario: Endpoint scene edit
- **WHEN** blend is `0`, left scene is active, and `HandleIncDec(0.1)` is called
- **THEN** only the left scene center value is incremented and clamped to the parameter range

#### Scenario: Selected inactive gesture arming
- **WHEN** a selected gesture is inactive for the current scene and `HandleIncDec(delta)` is called
- **THEN** the gesture becomes active for that scene
- **AND** its gesture value is copied from the current parent scene value
- **AND** the delta is not applied to the parent scene value or to the newly activated gesture value on that call

#### Scenario: Active high gesture edit after deselection
- **WHEN** a gesture is already active for the current scene
- **AND** the gesture is not currently selected
- **AND** the manager-owned gesture weight is `1.0`
- **AND** the gesture value is above the parent scene value
- **THEN** `HandleIncDec(delta)` applies the full clamped delta to the gesture value
- **AND** leaves the parent scene value unchanged

#### Scenario: Active gesture distribution
- **WHEN** one or more gestures are already active for the current scene selection
- **AND** their active effective weight sum is greater than zero
- **THEN** `HandleIncDec(delta)` distributes the gesture portion as `delta * weight * weight / activeEffectiveWeightSum` for each active gesture
- **AND** distributes the base portion as `delta * sum(weight * (1 - weight)) / activeEffectiveWeightSum`
- **AND** applies each portion through the scene distribution formula for the active scene blend
