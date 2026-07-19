1. [blocking] Runtime hotplug polling does not satisfy synced `smi-4` unchanged-list behavior. The main spec says unchanged consecutive polls schedule no message-thread reconciliation work, but `MidiConnectionManager::StartupReconcile()` unconditionally starts the poller with `ForceDirtyEnumerate()` and `OnTimerTick()` runs `Reconcile()` every dirty tick, even when the authoritative device list is unchanged. See [MidiConnectionManager.hpp](/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp:167) and [MidiConnectionManager.hpp](/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp:270). Either the synced spec needs to admit degraded mode, or the message-thread path needs an unchanged-list gate.

2. [minor] `projects/synth/README.md` still describes patch controls as “patch-command chrome” and says “shell chrome” shows the patch name/Save behavior, but the implementation and miniapp README now place that on `FilePage` inside `MainPane`. See [README.md](/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/README.md:160).

Deferred triage:

| Item | Triage |
|---|---|
| 1. `instrument_tests.cpp:~400` partial twister/launchpad endpoint round-trip assertions | OK-TO-DEFER: coverage spot-checks endpoints and profile data; add fuller assertions later. |
| 2. `MidiController.cpp:~1471` standalone `FromJSON(MidiControllerSlot&)` accepts kind-invalid combos | OK-TO-DEFER: real instrument/patch load gates through `MidiInstrumentConfig::AddController`. |
| 3. `parameter_modulation_tests.cpp:~7612` serialize endpoint refs asserted indirectly | OK-TO-DEFER: behavior is covered through load; direct JSON-shape assertion would be nicer. |
| 4. `parameter_modulation_tests.cpp:~3764` `FlushForTests` return unasserted | OK-TO-DEFER: affects test diagnostic quality, not production semantics. |
| 5. `MainPane resized()` unclamped for extreme small windows | OK-TO-DEFER: edge layout polish; not a normal-window merge blocker. |
| 6. `Shell.hpp` stale includes after chrome removal | OK-TO-DEFER: harmless compile-time cleanup. |
| 7. `SystemMessageCatalog SelectParamBank slotIx=0` limitation | OK-TO-DEFER: documented/current miniapp is slot 0; broaden when multi-slot app bank UI exists. |

I did not modify files or run tests/builds, per instruction. Stale deleted-type sweep found no live build-surface references to `MidiEndpointState`, `MidiPanel`, `AudioPanel`, or `ManualOpen*`; remaining hits are historical comments or the still-live forwarding helper class.

VERDICT: NEEDS-FIXES