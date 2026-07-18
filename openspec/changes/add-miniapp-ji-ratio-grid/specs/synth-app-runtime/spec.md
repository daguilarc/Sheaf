## MODIFIED Requirements

### Requirement: sar-3 — Context: application access to managers and configuration
WHEN the runtime initializes an application, THE runtime SHALL pass a pointer to an `AppContext` holding non-owning, address-stable pointers to the parameter manager, runtime-owned grid manager, patch manager, UI message input bus, MIDI message input bus, parameter message output bus, patch message input and output buses, MIDI sender, live and default MIDI instrument configurations, the runtime configuration, and the host's shared monotonic timestamp provider (so application UI code timestamps messages from the same clock as the engine); the grid-manager pointer SHALL be available during `Init` so an application can declare fixed grid/slot topology before runtime finalization, while the context's UI-state pointer SHALL be null during `Init` and SHALL be populated before MIDI processors, audio, or UI processing begin; all pointees SHALL remain valid for the application's lifetime.

#### Scenario: Context grants manager access during Init
- **WHEN** the application's `Init(AppContext*)` runs
- **THEN** the application can create groups, register modules and parameters, configure pages and banks through the context's parameter manager pointer, and declare fixed grid/slot topology through the runtime-owned grid-manager pointer

#### Scenario: Context pointers remain stable
- **WHEN** the application stores the context pointer during `Init` and dereferences a member from a hook permitted to touch that member under the sar-7 threading contract
- **THEN** every pointer refers to the same live object the runtime constructed
- **AND** the context documentation names the thread role permitted to use each member

#### Scenario: UI state populated after topology lock
- **WHEN** application initialization completes and the runtime creates the manager UI state
- **THEN** the context's UI-state pointer is set before the first MIDI processor rebuild, audio callback, or UI frame

#### Scenario: Application seeds a default instrument
- **WHEN** the application's `Init` populates the live MIDI instrument configuration through the context
- **THEN** the runtime snapshots it as the default instrument restored by revert/new
