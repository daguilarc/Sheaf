# Master Clock Task 7 Implementation Report

## Status

`DONE_WITH_CONCERNS`

Task 7 is implemented and verified. The concern is limited to an independent
MiniApp JUCE parity fixture that already violates the MiniApp initialization
contract at base commit `807fa4cf`; the modified production app and the
independent JUCE runtime session target both build and run successfully. One
isolated Braid deadline invocation also observed a non-reproducible host timing
spike; the original focused run, aggregate run, fresh final run, and three
unchanged diagnostic reruns all passed without loosening thresholds.

## Commits

- Implementation: `091aa9b1277f81b922c0acfac2d3ea143b72a3fe`
- Report: `docs(sdd): report master clock task 7` (this report-only commit; its
  exact hash is recorded in the parent handoff because a Git commit cannot
  embed its own final object ID without changing that object ID)

## Exact files changed

Implementation commit:

- `projects/synth/apps/miniapp/MiniAppCore.hpp`
- `projects/synth/apps/miniapp/README.md`
- `projects/synth/apps/braid-4/Braid4Core.hpp`
- `projects/synth/tests/miniapp_system_tests.cpp`
- `projects/synth/tests/braid4_system_tests.cpp`

Report commit:

- `.superpowers/sdd/master-clock-task-7-report.md`

The task brief, `.superpowers/sdd/progress.md`, OpenSpec artifacts, plan,
browser lockfile, and unrelated untracked `projects/synth/miniapp/` tree were
not staged or committed.

## Strict TDD evidence

### Group A: topology and UI order

Tests were added before production changes, then run with:

```sh
make -C projects/synth build/miniapp_system_tests && \
  projects/synth/build/miniapp_system_tests
```

RED compiled and exited 1 for the intended absent topology: the group still
reported capacity 192 instead of 272, MiniApp still exposed 12 rather than 17
top-level parameters, and the ADSR/Tempo order, colors, bank cells, sample-rate
preparation, and modulation-source-7 ownership were absent. No production file
had been changed before this RED.

After the minimal topology implementation, the same command was GREEN: 34/34
MiniApp tests passed.

### Group B: gate, same-frame publication, and Tempo authority

The real Engine/SynthRig gate, publication, and authority tests were added
before the per-frame implementation and run with the same focused MiniApp
command.

RED compiled and exited 1 for the intended missing behavior: the gate debug
observation did not exist, ADSR output remained zero because the module was not
processed, and Tempo request observation/change detection did not exist.

After implementing the exact committed-plan gate and Tempo request behavior,
the focused binary was GREEN: 37/37 MiniApp tests passed.

### Group C: Braid fractional positions and continuity

The fractional-query test was added before the Braid production change and run
with:

```sh
make -C projects/synth build/braid4_system_tests && \
  projects/synth/build/braid4_system_tests
```

RED compiled and exited 1 only for the intended missing conversion/debug query
contract; all 24 pre-existing Braid system tests passed in that RED run.

After threading the current plan and output-domain position through each
internal subframe, the same command was GREEN: 25/25 Braid system tests passed.
The isolated deadline binary then passed 5/5 without threshold changes.

## Contract evidence

### MiniApp topology, storage, and order

- The group remains 2 voices, 15 modulators, 3 scenes, one gesture, two pages,
  two banks, and one 16-encoder slot.
- Capacity is exactly `17 * (1 + 15) == 272`.
- The original twelve parameter IDs/order are retained. ADSR registers without
  a prefix as Attack, Decay, Sustain, Release at IDs 12-15, followed by Tempo
  at ID 16.
- Tempo is unipolar, White, Cyan/Orange-indicated, defaults with the exact
  normalized expression `(120 - 30) / (300 - 30)`, and maps exactly to
  30/120/300 BPM at its endpoint/default normalized values.
- LFO page/bank positions 0-9 are the five existing LFO parameters, ADSR A/D/S/R,
  and Tempo; positions 10-15 are unbound. VCO/filter and ratio-grid tests remain
  green.
- ADSR is prepared at the negotiated output sample rate.
- A direct, stable `std::array<float, 2>` mirror owns source-7 storage. Source 7
  is connected as Blue `ADSR`; established source ownership at 0-6 and 8-14 is
  unchanged.

### Gate, publication, Tempo, and authority

- Each output frame processes group parameters at the absolute integer sample,
  reads only the callback's immutable `block.clockPlan`, and gates both ADSR
  voices from running transport phase `[0, 0.5)`.
- At 8 Hz with three-frame non-divisor blocks, real committed plans prove high
  at samples 0-1, low beginning at sample 2, low at sample 3, retrigger/high at
  samples 4-5, and low at sample 6 when Stop takes effect in the next plan.
- ADSR processes after inputs are set; its const outputs are copied to the
  stable mirror before `UpdateModValues`. A one-frame test proves both source-7
  values equal the current module outputs/mirror in that same frame.
- Tempo derives once per frame from voice 0 through the exact 30-300 mapping.
  The 120 BPM cache seed prevents a default request; every genuinely changed
  effective value is requested once and cached regardless of acceptance.
- A manual 180 BPM change is accepted but cannot alter the already committed
  120 BPM plan; the following plan uses 180 BPM. Under receive-clock authority,
  a changed 90 BPM control produces one rejected request while external tempo
  stays authoritative. Disabling receive restores the last accepted manual
  180 BPM and does not replay cached rejected 90 BPM.

### Braid every-subframe fractional continuity

- Parameter processing retains its existing global integer internal index.
- Clock observation uses the separate exact conversion
  `double(block.startSample) + double(localInternalIndex) / 4.0`.
- A non-null committed plan is queried exactly once for each internal subframe;
  the allocation-free per-block observation does not feed DSP and no plan
  pointer is retained.
- For a five-output-frame block, tests prove 20 attempted/successful queries,
  positions `S`, `S + 0.25`, `S + 0.5`, `S + 0.75`, local index 6 at `S + 1.5`,
  and the half-open last position `S + 4.75`.
- The adjacent plan begins exactly at `S + 5`, its lifetime value is strictly
  greater than the previous last internal-sample value, and a requested
  120-to-180 BPM slope change affects only that next committed plan.
- Existing Braid topology, decimation, parameter cadence, audio, continuity,
  and deadline tests remain green.

## Verification

- `make -C projects/synth build/miniapp_system_tests` and
  `projects/synth/build/miniapp_system_tests`: 37/37 passed.
- `make -C projects/synth build/braid4_system_tests` and
  `projects/synth/build/braid4_system_tests`: 25/25 passed.
- `make -C projects/synth build/braid4_deadline_tests` and
  `projects/synth/build/braid4_deadline_tests`: 5/5 passed in the original and
  final focused runs; three unchanged diagnostic reruns also passed 5/5.
- `make -C projects/synth test` (serial): exit 0; every aggregate portable/core
  test binary and the UI boundary check passed.
- `make -B -C projects/synth build/miniapp_system_tests build/braid4_system_tests build/braid4_deadline_tests`:
  clean warning-enabled rebuild with `-Wall -Wextra -Wpedantic`; no warnings.
- `make -C projects/synth/apps/miniapp`: exit 0; the modified MiniApp JUCE app
  bundle compiled successfully.
- Independent MiniApp JUCE runtime-shell session target compiled and executed:
  exit 0 (with a non-fatal CoreMIDI environment log).
- `openspec validate add-synth-master-clock-midi-sync --strict`: valid.
- `git diff --check`: clean before staging, on the staged implementation, and
  in the fresh final verification pass.

## Self-review

- Confirmed the production change is limited to MiniApp, Braid's read-only
  clock observation, and MiniApp documentation; no runtime callback, mutable
  plan, per-sample clock buffer, or oversampling API was added.
- Confirmed ADSR output storage exposed by MiniApp is const-only; source pointers
  refer to direct app-owned stable storage.
- Confirmed Braid lifetime queries are observational and do not influence DSP,
  modulation, cadence, decimation, or output.
- Confirmed exact staged implementation file scope before the first commit and
  preserved all unrelated dirty/untracked state.
- No timing threshold, unrelated fixture, OpenSpec checkbox, or plan file was
  altered.

## Concerns

Running the independently built
`projects/synth/apps/miniapp/build/miniapp_juce_backend_parity_tests` exits 134
with `std::logic_error: MiniApp requires an initialization-time grid manager`.
Inspection at exact base commit `807fa4cf` shows both sides of the pre-existing
fixture mismatch: `MiniAppCore::Init` already requires `context_->gridManager`,
while the unchanged parity test's handcrafted `AppContext` does not set it.
Task 7 does not repair or work around this unrelated fixture.

One forced-rebuild deadline invocation had only the 48 kHz baseline p99 case
exceed its threshold while the other four cases passed. Without any code or
threshold change, three isolated reruns and the final verification all passed;
final 48 kHz p99 was 1.77 ms against a 5.33 ms block. This is consistent with a
single host scheduling spike, but is recorded rather than hidden.
