## Task 2: Transport State, External PLL, Source Arbitration, and Crossing Production (Sol)

**OpenSpec Tasks Covered:** 2.3–2.6, 3.1–3.4, remaining clock-side portion of 7.5

**Primary Files:**

- Modify `projects/synth/include/synth/MasterClock.hpp` and `projects/synth/src/MasterClock.cpp`.
- Modify `projects/synth/tests/master_clock_tests.cpp`.
- Add a dedicated PLL test/source file if separation makes the policy easier to test without broadening public API.

**Required behavior:**

- [ ] Add failing transition tests for internal/external Start, Continue, Stop, armed activation, timestamped tick zero, first-plan phase projection, repeated commands, output-only transition splices, source switching, and current-run rather than song-position semantics.
- [ ] Implement `Stopped`, `ArmedStart`, `ArmedContinue`, and `Running`; gate external commands with receive policy and source ownership; apply internal commands at the next plan boundary and external commands at normalized timestamps.
- [ ] Add exact and jittered timestamp-trace tests for PLL acquisition, median/EWMA values, duplicate and out-of-order rejection, inferred missed pulses `2..8`, bounded phase correction, hard reacquisition, free-run dropout, and 120-BPM accuracy after 64 intervals.
- [ ] Add multi-controller tests for provisional transport ownership, deterministic first-source lock, foreign rejection, timeout `max(500 ms, four periods)`, takeover, and continuous phase/BPM diagnostics.
- [ ] Implement source arbitration and the isolated estimator without locks or allocation, retaining manual tempo for later restoration.
- [ ] Add analytical crossing tests for stopped lifetime ticks, running transport ticks, fractional deadlines, half-open ownership, Start/Continue splice ordering, tick-zero dedup, Stop switch priming, PPQN phase safety, generation/cutoff publication, and send+receive regenerated phase.
- [ ] Use the owned `Phasor2Tick` as the priming/last-cell authority for candidate crossings. Verify no O(block-size) per-sample loop exists.
- [ ] Define the JUCE-free producer boundary used by later integration: a `ScheduledMidiEvent` value plus a non-owning `IScheduledMidiEventSink::TryEnqueue(const ScheduledMidiEvent&) noexcept`-style contract. The event carries due time, sequence, broadcast/transport ordering intent, phase generation, and cutoff data. The contract requires fixed-capacity, newest-drop, allocation-free, mutex-free producer semantics and observable overflow; Task 3 uses a fixed-capacity test double, while Task 4 makes `MidiSender` the production implementation and owns worker consumption.
- [ ] Run focused clock tests plus `make -C projects/synth test` before review.
- [ ] Commit only the task files after review and verification.
