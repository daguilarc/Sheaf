## ADDED Requirements

### Requirement: scw-1 — Architecture: typed controller wizard and portable config form
WHEN a controller-specific configuration wizard is implemented, THE synth controller-wizard system SHALL provide a JUCE-free polymorphic wizard contract that creates a wizard-specific in-memory configuration form and generates a complete controller profile from that form, SHALL expose each form through the shared portable `ui::Surface` tree/action contract, SHALL keep form ownership explicit, and SHALL ensure that a wizard can generate a profile only from the concrete form type it created.

#### Scenario: Concrete wizard creates its concrete form
- **WHEN** the MF Twister wizard creates a configuration form
- **THEN** the caller owns it through the abstract config-form contract
- **AND** the wizard retains a checked typed generation path for the concrete MF Twister form

#### Scenario: Form is portable and side-effect free
- **WHEN** a config form builds its tree or handles a field action
- **THEN** it reads or mutates only its in-memory form state
- **AND** it does not open MIDI endpoints, edit the engine, save runtime configuration, or call JUCE, DOM, or Web MIDI APIs

#### Scenario: Wrong form type cannot mutate configuration
- **WHEN** a wizard is asked to generate from a form created by a different wizard
- **THEN** generation reports a type-mismatch error
- **AND** no controller profile or instrument configuration is changed

### Requirement: scw-2 — Discovery: baked pair registry and candidate classification
WHEN present MIDI devices are classified for controller setup, THE synth controller-wizard system SHALL use a baked ordered registry of input/output pair matchers and wizard factories, SHALL produce deterministic candidates containing the concrete input and output endpoint identities, SHALL assign each present endpoint to at most one candidate, and SHALL classify a candidate as available only when neither endpoint is claimed by an active or blacklisted instrument record.

#### Scenario: Recognized unclaimed pair is available
- **WHEN** a registry-recognized input and output are both present and neither is referenced by any instrument record
- **THEN** discovery returns one available candidate carrying both identifiers and names
- **AND** the available-candidate warning state is true

#### Scenario: Active profile suppresses discovery
- **WHEN** an active controller record claims either endpoint of an otherwise recognized pair
- **THEN** discovery does not offer that pair as an available candidate

#### Scenario: Blacklist suppresses discovery
- **WHEN** a blacklisted controller record claims a recognized pair
- **THEN** discovery does not offer that pair as an available candidate
- **AND** the pair does not contribute to the warning state

#### Scenario: Pairing is deterministic and exclusive
- **WHEN** discovery receives the same ordered device lists and instrument snapshot twice
- **THEN** it returns candidates in the same order with the same pairings
- **AND** no input or output identity occurs in more than one candidate

#### Scenario: Half-configured record prevents contention
- **WHEN** an existing record claims only the input or only the output of a recognized pair
- **THEN** discovery does not offer the pair
- **AND** wizard submission cannot create a second record contending for the claimed endpoint

### Requirement: scw-3 — MF Twister: six-button form and generated profile
WHEN the baked registry recognizes a MIDI Fighter Twister pair, THE synth controller-wizard system SHALL provide an MF Twister config form with six message-dropdown and argument-control pairs arranged as two columns of three buttons, SHALL initialize buttons 0 through 5 respectively to Hold Reset, Hold Random, Hold Random Mod, Next Bank for slot 0, Start Transport, and Previous Bank for slot 0, and SHALL generate an active MF Twister profile using the selected messages, the existing sixteen-encoder defaults, the discovered input/output references, and side-button addresses on zero-based channel 3 CCs 8 through 13.

#### Scenario: Form has the six defaults
- **WHEN** a new MF Twister form opens
- **THEN** buttons 0 through 2 appear in the first column and buttons 3 through 5 in the second
- **AND** their dropdowns and arguments have the specified default values

#### Scenario: Hold modifiers generate release messages
- **WHEN** the default form is submitted
- **THEN** Reset, Random, and Random Mod generate true-valued press messages and matching false-valued release messages
- **AND** the three mappings occupy side buttons 0, 1, and 2

#### Scenario: Bank arguments select parameter slot
- **WHEN** the user assigns argument `4` to Next Bank or Previous Bank and submits
- **THEN** the generated relative-bank message carries `slotIx = 4`
- **AND** no bank-index argument is introduced

#### Scenario: No-argument action disables its argument editor
- **WHEN** a button selects Start Transport or another no-argument message kind
- **THEN** its paired argument control is visibly disabled
- **AND** its stored numeric value does not affect the generated message

#### Scenario: Generated profile uses Twister hardware addresses
- **WHEN** a valid six-button form is generated
- **THEN** it contains sixteen default encoder turn, push, and output mappings
- **AND** its six side-button associations use channel 3 CCs 8 through 13 with side-button output feedback disabled

#### Scenario: Invalid form is atomic
- **WHEN** a form contains an unsupported message choice or an out-of-range argument
- **THEN** submission reports the affected field
- **AND** no profile is installed and the entered form state remains available for correction

### Requirement: scw-4 — Lifecycle: submit, ignore, and reconfigure
WHEN a wizard candidate or wizard-associated controller record is acted upon, THE synth controller-wizard system SHALL revalidate the target before committing, SHALL install valid generated profiles through one host-provided instrument commit, SHALL persist Ignore as a blacklisted record with no runtime-active profile, SHALL preserve the existing name, endpoints, and ordered position when reconfiguring a stored record, and SHALL request runtime-configuration save only after a Submit or Ignore commit succeeds.

#### Scenario: New candidate installs atomically
- **WHEN** a present unclaimed candidate's valid form is submitted
- **THEN** one active controller record with both endpoint references and the generated profile is committed
- **AND** the candidate ceases to be available
- **AND** runtime-configuration save is requested after the commit

#### Scenario: Disappeared candidate refuses submit
- **WHEN** either endpoint of a new candidate disappears after its form opens and before Submit
- **THEN** submission reports that the controller must reconnect
- **AND** the form data and instrument configuration remain unchanged

#### Scenario: Ignore persists an inert record
- **WHEN** the user ignores an available candidate
- **THEN** one blacklisted record with the pair's hardware kind and endpoint identities is committed without an active profile
- **AND** the pair ceases to be available
- **AND** runtime-configuration save is requested after the commit

#### Scenario: Refused action does not save
- **WHEN** Submit or Ignore is refused before the instrument commit
- **THEN** runtime-configuration save is not requested
- **AND** the prior persisted configuration remains authoritative

#### Scenario: Reconfigure preserves record identity
- **WHEN** an existing wizard-associated active or blacklisted record submits a valid form
- **THEN** its generated profile and Active disposition replace the prior profile/disposition
- **AND** its name, input/output references, and ordered position are preserved

#### Scenario: Offline existing record can be reconfigured
- **WHEN** an existing wizard-associated record's stored devices are absent
- **THEN** its form SHALL open from the stored kind and available profile data
- **AND** valid generation and commit SHALL NOT require the endpoints to be present
