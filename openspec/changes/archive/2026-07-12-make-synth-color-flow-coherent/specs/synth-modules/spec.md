## ADDED Requirements

### Requirement: smod-12 — Reusable module semantic color roles
WHEN a reusable synth module registers colored parameters or publishes colored scopes, THE module SHALL expose role-specific configuration for parameter base colors, per-voice indicator colors, and scope-trace colors; SHALL NOT infer any of those colors from parameter-group topology; and SHALL use role-specific method names where setters remain public.

#### Scenario: Braid module separates base from indicators
- **WHEN** a `Braid4VcoModule` registers X/Y, quad, and mono oscillator controls
- **THEN** its options can assign one shared base family color and four oscillator indicator shades
- **AND** Tune/Phase/Shape/Gain use the shared base with all four indicator shades
- **AND** each PM/Frequency parameter uses its associated shade as base and indicator

#### Scenario: General modules accept parameter indicators
- **WHEN** MiniApp registers reusable wavetable VCO, classic filter, and basic LFO modules into one two-voice group
- **THEN** each module can apply the caller's two parameter indicator colors to every registered parameter
- **AND** no group palette is required

#### Scenario: Scope color is independently assigned
- **WHEN** a caller assigns an oscillator scope-trace color
- **THEN** it uses a `SetScopeColor` API
- **AND** changing that trace color does not mutate registered parameter or bank colors

#### Scenario: Matrix setter names parameter role
- **WHEN** a matrix caller assigns diagonal and off-diagonal parameter colors
- **THEN** it uses `SetParameterColors`
- **AND** the module exposes no unused generic color getter
