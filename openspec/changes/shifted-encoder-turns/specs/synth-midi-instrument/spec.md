# Delta — `synth-midi-instrument`

smi-16 is modified as it stands in the active change `shift-and-file-export`
(jvictor0/Sheaf#14), which added it. Its body changes one clause, "consumed
only by that same profile's system-button processor", to "read only by that
same profile's system-button and encoder processors", and gains the sentence
pointing to smi-17; every scenario is carried forward word for word.

## MODIFIED Requirements

### Requirement: smi-16 — Shift: a held button swaps other buttons' presses
WHEN a system-button mapping's press targets `Shift`, THE synth system SHALL hold per-profile state, a held flag, set by that button's press and cleared by its release, read only by that same profile's system-button and encoder processors and never placed on the message bus; neither edge SHALL push any message. WHILE held is set, THE synth system SHALL, for any other system-button press on that profile whose association carries a shifted press, push that shifted press in place of the ordinary press, stamped as the ordinary press would have been, and SHALL push the ordinary press for an association without one; a button's release SHALL behave exactly as it does unshifted. What a held Shift does to an encoder turn is smi-17. Shift and Hold Drill SHALL be independent: either may be held while the other is. A Shift press whose release never arrives SHALL leave the profile shifted until the next Shift press and release.

#### Scenario: Shift swaps a press and its release restores it
- **WHEN** the Shift button is held, a button with a shifted press is pressed, Shift is released, and the same button is pressed again
- **THEN** the first press pushes the shifted message and the second pushes the ordinary one
- **AND** no message is pushed for the Shift button's own press or release
- Check: `instrument_tests.cpp: ShiftHeldSwapsPressForShiftedPressAndReleaseClearsIt`

#### Scenario: A button without a shifted press ignores Shift
- **WHEN** the Shift button is held and a button with no shifted press is pressed
- **THEN** its ordinary press is pushed
- Check: `instrument_tests.cpp: ShiftHeldSwapsPressForShiftedPressAndReleaseClearsIt`

#### Scenario: Shift and Hold Drill do not interfere
- **WHEN** both a Shift button and a Hold Drill button are held and an encoder is turned and a shifted button pressed
- **THEN** the turn drills once and the press pushes the shifted message
- Check: `instrument_tests.cpp: ShiftAndHoldDrillAreIndependent`

## ADDED Requirements

### Requirement: smi-17 — Shift: an encoder turn's shifted job
WHEN an encoder turn mapping carries a shifted job and that profile's Shift is held, THE synth system SHALL push the shifted job in place of the turn's parameter message, and SHALL push the parameter message exactly as before while Shift is not held or the mapping carries no shifted job. The one shifted job SHALL be Scene blend: in a relative encoder mode a turn SHALL push a scene-blend increment carrying the turn's decoded delta, which the message bus SHALL apply on the audio thread by adding it to the current blend and clamping the result to 0..1; in Absolute mode a turn SHALL push a scene-blend set to the turn's normalized value. WHILE Hold Drill is held, a turn SHALL drill exactly as it does without Shift, whether or not Shift is also held. After Hold Drill is released while Shift is still held, a turn with a shifted job SHALL do the shifted job. An encoder push mapping SHALL carry no shifted job, and a profile config whose push mapping carries one SHALL be reported invalid. A turn's shifted job SHALL serialize with its mapping under a `shiftedJob` key written only when the mapping has one; a document without the key SHALL load with no shifted job, and a document naming a shifted job the library does not know SHALL fail to load with the target configuration unchanged. The scene-blend increment SHALL be a new message kind appended after `Shift`, so no existing kind's ordinal moves.

#### Scenario: A shifted turn moves the scene blend and releasing Shift restores the knob
- **WHEN** a relative turn mapping with shifted job Scene blend is turned while Shift is held, Shift is released, and it is turned again
- **THEN** the first turn pushes a scene-blend increment carrying the decoded delta and no parameter message
- **AND** the second turn pushes the parameter message and no scene-blend message
- Check: `instrument_tests.cpp: ShiftHeldTurnPushesSceneBlendIncrementAndReleaseRestoresTheParameter`

#### Scenario: An absolute shifted turn sets the blend
- **WHEN** an Absolute-mode turn mapping with shifted job Scene blend receives value 127 while Shift is held
- **THEN** a scene-blend set of 1.0 is pushed and no parameter message
- Check: `instrument_tests.cpp: ShiftHeldAbsoluteTurnSetsTheSceneBlend`

#### Scenario: Hold Drill still drills a knob that has a shifted job
- **WHEN** Shift and Hold Drill are both held and a turn mapping with shifted job Scene blend is turned twice
- **THEN** exactly one push message is pushed for that knob and no scene-blend message
- Check: `instrument_tests.cpp: HoldDrillDrillsAShiftedTurnWhileBothAreHeld`

#### Scenario: The increment adds to the blend and clamps
- **WHEN** the blend is 0.95 and increments of +0.1 and then -2.0 are applied
- **THEN** the blend reads 1.0 after the first and 0.0 after the second
- Check: `parameter_modulation_tests.cpp: SceneBlendIncrementAddsToTheBlendAndClamps`

#### Scenario: A shifted job round-trips, its absence reads as none, and an unknown one fails
- **WHEN** an encoder config whose turn carries shifted job Scene blend is serialized and reloaded
- **THEN** that turn's shifted job is Scene blend and every other turn has none
- **AND** the serialized form of a turn without a shifted job has no `shiftedJob` key
- **WHEN** a document names `shiftedJob` `"tempo"`
- **THEN** the load fails and the target configuration is unchanged
- Check: `instrument_tests.cpp: EncoderTurnJsonRoundTripsShiftedJobAndRejectsAnUnknownOne`

#### Scenario: A push cannot carry a shifted job
- **WHEN** a profile config's encoder push mapping carries shifted job Scene blend
- **THEN** the config is reported invalid and cannot be committed
- Check: `instrument_tests.cpp: ProfileWithAShiftedEncoderPushIsInvalid`
