Committed successfully as `49bcad0`. Working tree is clean.

## Summary

**Status**: Complete. All 5 reviewer findings fixed, tests green, apps link cleanly, smoke test passed.

**Commit**: `49bcad0` — "fix(synth): presentation maintenance for block commits, overlap refusal, safe interim rendering"

**Test summary**: `make -C projects/synth build test` — 531 tests pass, 0 failures, 0 compiler warnings (clean `rm -rf build`). `make -C projects/synth apps` — links cleanly, 0 warnings, 0 errors. Launch smoke (8s timeout) — normal startup (MIDI reconcile, audio device prepare), no crash/error, still running at timeout.

**Staging approach for findings 1/2**: Option (a) — optimistic staging. `ApplyMappingEdit`'s block branch and `AddBlock` write the new block struct + identities directly into the view model's own `presentations_` cache at the same time they populate `out`, documented as a same-instance cache-priming hint (not a claim the edit landed — if the host discards `out`, the next real `Rebuild()` self-heals via the existing drop/append rule). Chosen over staging-in-Rebuild (option b) because individual-row edits already implicitly depend on the same "host commits then rebuilds this instance" pattern.

**Finding-3 individual-edit decision**: Individual-row address edits (Channel/Cc/LaunchpadX/Y/WrldBldrX/Y/Button on non-block rows) keep their historical behavior — no duplicate-address refusal added there. sru-10's all-or-nothing/duplicate-address language is scoped to block commits specifically, and no prior test or spec scenario required refusal for individual edits; documented inline as a deliberate scope boundary. `AddSingle` got the same duplicate check defensively anyway (structurally unreachable given its "next free" address selection, but cheap insurance).

One notable discovery during finding 4: a background audit surfaced that a blanket "skip editor if `RowFieldValue` returns false" renderer rule would have broken the `AnalogSceneBlend` row (unassigned scene blend is a legitimate, common state that must remain assignable) — fixed at the source by making `RowFieldValue` return a stable 0.0 default for that case instead of special-casing the renderer, with dedicated red/green test coverage.

Full fix report appended to `.superpowers/sdd/blocks-t2-report.md` (gitignored working notes, not committed).