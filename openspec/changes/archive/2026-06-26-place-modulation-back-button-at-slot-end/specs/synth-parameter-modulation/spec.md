## MODIFIED Requirements

### Requirement: spm-15 — Banks and slots: press, shift-press, and tick routing
WHEN a bank handles a press on a mapped physical encoder, THE bank SHALL populate the pressed parameter's visible modulation-depth cells from its modulation-depth parameter array, SHALL materialize missing modulation-depth parameters as bipolar default-zero parameters when group capacity allows, and SHALL place the selected top-level parameter in the final physical slot position as the return cell when the press is routed through a `BankSlot`; direct bank presses without a slot layout SHALL use the bank's compact top-level mapping order as the physical layout fallback. If a routed slot has `N` physical positions, THE system SHALL reserve position `N - 1` for the return cell, SHALL use positions `0..N-2` for modulation-depth cells, SHALL leave unused positions before the return cell disconnected, and SHALL treat `numModulators > N - 1` as a configuration error. Pressing a modulation cell SHALL open that modulation parameter's modulation view; pressing the return cell SHALL restore the top-level bank; tick and shift-press SHALL route to the parameter visible in the pressed cell; shift-press SHALL revert the pressed parameter to default; and routed manager/slot APIs SHALL dispatch press, shift-press, and tick/inc-dec events by physical encoder ID to the selected bank.

#### Scenario: Press opens modulation view
- **WHEN** a bank is showing top-level parameters and the user presses a parameter encoder through a slot
- **THEN** the bank shows that parameter's modulation-depth cells in the first slot positions
- **AND** shows the selected parameter as the return cell in the final slot position

#### Scenario: Slot gap remains disconnected
- **WHEN** a slot has three physical positions
- **AND** the pressed parameter's group has one modulator
- **THEN** the modulation-depth cell occupies the first slot position
- **AND** the middle slot position is disconnected
- **AND** the return cell occupies the third slot position

#### Scenario: Too many modulators for slot layout is an error
- **WHEN** a slot has three physical positions
- **AND** the pressed parameter's group has three modulators
- **THEN** opening that parameter's modulation view fails as a configuration error because no final slot position remains reserved for return

#### Scenario: Return cell closes modulation view
- **WHEN** a modulation-depth view is open
- **AND** the return cell in the final slot position is pressed
- **THEN** the bank restores the top-level parameter view
