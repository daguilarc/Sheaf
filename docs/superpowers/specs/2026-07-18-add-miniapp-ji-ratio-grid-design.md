# MiniApp Just-Intonation Ratio Grid Design

## Goal

Give MiniApp one runtime-owned button-grid slot that independently selects a
just-intonation pitch ratio for each of its two VCO voices.

## Scope

MiniApp configures one slot and one selected grid spanning the exclusive range
`(0,0)` to `(8,2)`. The two rows contain these eight ratios in x order:

`1/2`, `3/4`, `2/3`, `1/1`, `5/4`, `3/2`, `4/3`, `2/1`.

The originally listed `6/5` minor third is intentionally excluded. Row `0`
controls voice `0`; row `1` controls voice `1`. No MiniApp on-screen controls,
new MIDI profile defaults, or persistence format changes are part of this
change.

## Ownership and Topology

`Engine` remains the sole owner of `GridManager` and its UI state. `AppContext`
gains a non-owning `GridManager*` that is valid while an application performs
pre-audio `Init`; applications use it only to declare their fixed topology.
`Engine` continues to finalize and publish that topology after `Init` returns.

During `MiniAppCore::Init`, MiniApp creates its one slot and one matching grid,
registers all 16 cells, and selects that grid for slot `0`. Any failed
construction or registration is a programmer/topology error and fails loudly
during initialization, before audio starts.

## Cell State and Feedback

MiniApp owns two row-selection indices, both initialized to x `3` (`1/1`) so
startup audio is unchanged. Every row uses its own shared index as the state
backing for eight `StateCell<std::size_t>` instances in `SetOnly` mode. A press
sets only its row's selected index; release and pressure changes leave it
unchanged. Therefore exactly one cell per row is on at all times.

Each ratio has one stable, distinct color shared by both rows. Its selected
cell publishes the full color; its non-selected cells publish that same color
at dim brightness. The manager's existing UI publication packs selected state
into the color alpha byte, so MIDI grid feedback needs no special path.

## Audio Behavior

MiniApp retains normal parameter, scene, gesture, and modulation processing.
After `WavetableVcoModule::SetInput` prepares the two voices and before its
`Process`, `MiniAppCore::ProcessBlock` multiplies voice `0`'s normalized VCO
frequency by the selected row-0 ratio and voice `1`'s by row-1's ratio. This
is an application-local pitch offset, not a write to the shared Tune parameter;
it does not alter parameter persistence or controller behavior.

## Verification

MiniApp system tests prove the exact half-open geometry, selected grid/slot,
ratio order, default unity state, independent set-only row selection, packed
full-versus-dim color feedback, and per-voice frequency multiplication.
Existing full synth and MiniApp/JUCE suites guard lifecycle and UI-backend
compatibility.
