## Context

The synth MIDI output path mirrors `ParameterManager::UIState` visible cells to configured controller output mappings. An MF Twister profile may map any subset of the hardware encoders; common profiles may map many or all of them, but the output processor should only act on configured mappings. For each configured mapping, a real connected slot/position uses live UI state, a real but disconnected slot/position blanks, and a slot/position outside current UI-state capacity also blanks. Unmapped physical encoders are ignored.

The current output processors already distinguish stable UI snapshots from transient torn reads using `Parameter::UIState::revision`. The implementation should preserve that distinction: a mapped encoder with no backing UI cell is stable blank feedback state, while a concurrently written cell remains a transient read failure to retry on a later pass. `CellSnapshot` is only the current C++ helper used to copy the app-independent UI-state fields before formatting controller-specific MIDI messages; it is not an app-owned model and should not define the hardware/profile contract.

## Goals / Non-Goals

**Goals:**

- Ensure MF Twister output mappings for disconnected cells send channel `2` RGB brightness-off value `17` and channel `5` indicator brightness-off value `65`.
- Treat mappings outside current slot/cell capacity as stable blank feedback state so mapped hardware encoders with no live app/UI target are darkened.
- Keep existing debounce/cache behavior so repeated process calls do not spam identical blank feedback.
- Add focused regression coverage for realized disconnected cells and mappings beyond realized positions.

**Non-Goals:**

- Do not change MIDI profile JSON, controller configuration UI, or patch persistence.
- Do not change WRLD.Bldr, Launchpad, or system-message output semantics.
- Do not introduce a new runtime connection state; this is about per-position UI-cell connectivity, not USB device online/offline status.

## Decisions

1. Translate unbacked mapped encoder targets to stable blank feedback state.

   This keeps the MIDI profile and hardware model app-independent: the profile chooses which physical encoders to map, and the UI-state lookup decides whether each mapped encoder currently has live cell data. The downstream output path then formats either live feedback or blank feedback. The alternative was to treat an absent UI cell like `std::nullopt`, but `std::nullopt` has existing retry semantics for unstable snapshots and would leave hardware cache/state unchanged. Encoders with no output mapping never enter this path and remain ignored.

2. Keep Twister blanking centralized in `TwisterMidiOutProcessor::Process`.

   The processor already computes value, color, RGB brightness, indicator value, and indicator brightness from a `blank` predicate. Extending tests around that predicate is less fragile than scattering Twister-specific brightness logic into snapshot loading.

3. Verify both disconnected sources independently.

   A realized unused cell exercises the `connected=false` path. A mapping outside `slotCapacity` or `cellCapacity` exercises the mapped-but-unbacked path where no backing UI cell exists. Unmapped encoders need no blanking test because the processor has no configured output mapping to process.

## Risks / Trade-offs

- [Risk] Treating unbacked UI targets as blank could hide a configuration mismatch during development. → Mitigation: this behavior is limited to MIDI output feedback; configuration validation and tests still cover profile shape separately.
- [Risk] Blank feedback might be resent too often after this change. → Mitigation: keep using the existing per-mapping cache and add assertions that repeated process calls without state changes emit no duplicates.

## Migration Plan

No data migration is required. The implementation can ship as a processor/test change; rollback is a normal code revert because no persisted schema or user configuration changes are introduced.

## Open Questions

None.
