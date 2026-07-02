# synth-patch-persistence Delta

## MODIFIED Requirements

### Requirement: spp-8 — Miniapp patch manager integration
WHEN the synth miniapp is run without a patch-picker UI, THE synth application runtime hosting the miniapp SHALL instantiate the library patch manager and patch message buses, consume patch lifecycle messages after the application's ordinary initialization, and use the deterministic temporary patch directory declared by the miniapp's runtime configuration for save-as/load demonstrations.

#### Scenario: Miniapp save-as writes under tmp
- **WHEN** the miniapp requests save-as without a file picker
- **THEN** it uses a deterministic directory under `/tmp` declared as the miniapp's configured patches root
- **AND** the JSON version file is written by library patch manager/file helpers

#### Scenario: Miniapp load/revert route through patch messages
- **WHEN** the miniapp loads or reverts a patch
- **THEN** patch JSON load is delivered through `LoadFromJSON` or `RevertAllToDefault` patch messages
- **AND** the runtime rebuilds MIDI processors from the loaded MIDI profile config after consuming a load message
