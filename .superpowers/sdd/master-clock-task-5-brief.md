# Synth Master Clock/MIDI Sync — Task 5 Brief

## Assignment

Implement plan Task 5, **Browser Timestamped MIDI End to End**, from base commit `393c989f`.

Covered OpenSpec tasks: **8.1–8.4**.

Read all OpenSpec artifacts, the Superpowers plan, Task 1–4 reports, current browser C++ bridge/runtime services, browser TypeScript protocol/worker/MIDI/audio code, sender contracts, and every focused C++/Node/Playwright test before editing. Use repository `about-me`, `software-principles`, `git-workflow`, and Superpowers TDD/verification instructions.

Do not modify parent progress/brief/checklists/prior reports/review packages. Preserve the user-owned untracked `projects/synth/browser/package-lock.json` and `projects/synth/miniapp/`; never stage them.

## Required behavior

### C++/worker protocol and bounded priority

- Extend outbound browser MIDI records across C++ ABI, worker protocol, and TypeScript with absolute engine-epoch `dueTimeMicros` plus enough immediate/scheduled distinction to preserve existing controller feedback.
- Immediate controller feedback remains valid and ordered. Scheduled clock/transport retains its original deadline and generation/cutoff semantics; browser drain time, animation cadence, and worker wake time never replace the deadline.
- Keep all queues fixed/bounded. Realtime scheduled clock/transport must not be starved by availability/feedback traffic. Define deterministic ordering and newest-drop/late diagnostics at each bounded boundary; do not create an unbounded JS array.
- Preserve reconnect semantics: an offline output receives nothing, reconnect joins future scheduled events only, with no stale replay.

### Shared timestamp epoch and Web MIDI delivery

- Normalize inbound Web MIDI `event.timeStamp` into the shared performance-time-origin-relative integer-microsecond epoch before C++ delivery. Preserve controller slot identity and exact Start/Continue/Stop/Clock order/timestamps.
- Ensure `performance.now()`, `emscripten_get_now()`, worker messages, audio callback timestamps, Web MIDI input timestamps, C++ engine timestamps, and outbound deadlines share the explicitly documented origin/conversion. Do not mix DOM absolute epoch milliseconds with time-origin-relative values.
- Convert outbound engine microseconds to the `DOMHighResTimeStamp` expected by `MIDIPort.send` and call `port.send(bytes, timestamp)`. The timestamp must be derived from the record's due time, not from drain time. Immediate events continue to use the compatible immediate send path.
- Timer throttling or late drain sends as soon as possible, increments observable lateness, and does not rephase or rewrite the stored deadline.

### End-to-end cases

- Add C++ bridge/ABI and TypeScript/Node tests for due-time transport, bounded drain ordering/priority, immediate compatibility, inbound normalization, Start-plus-first-clock order, generation cutoff behavior, continuous stopped clock, reconnect/no-replay, and late/timer-throttling diagnostics.
- Add Playwright/browser integration coverage that drives the real worker/bridge/Web MIDI seams where existing harnesses allow deterministic fakes.
- Preserve the concrete Task 4 `MidiSender` semantics and do not duplicate sender scheduling logic in browser availability transport.

## Scope boundaries

- Do not implement the portable Sync page, host persistence UI, MiniApp ADSR/tempo, or documentation/final-trace Task 8.
- Do not change JUCE scheduled delivery except if a shared compile contract requires a compatibility-only adjustment; justify any such path.
- Do not alter the master-clock/PLL/mapper numeric policy.

## Likely files

- `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`
- `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- `projects/synth/browser/cpp/BrowserRuntimeAbi.cpp`
- `projects/synth/browser/src/protocol.ts`
- `projects/synth/browser/src/worker.ts`
- `projects/synth/browser/src/midi.ts`
- `projects/synth/browser/src/audio.ts`
- focused browser C++ tests, Node tests, Playwright specs, build/Makefile dependencies

Follow discovered seams and explain additional paths in the report.

## RED/GREEN, verification, and commits

Capture genuine C++ and TypeScript/Node missing-contract REDs before production changes. Run all focused browser bridge/ABI/runtime C++ targets, TypeScript build/typecheck, Node tests, browser WASM/static assets, then the complete Playwright workflow (64-case baseline or updated count). If Chromium sandboxing fails, rerun the same test command using the approved escalated path; distinguish infrastructure failures from product failures. Also run affected core sender/Engine tests, `make -C projects/synth test`, strict OpenSpec validation, and exact diff/scope checks.

Create exactly two commits:

1. implementation and tests;
2. metadata-only `.superpowers/sdd/master-clock-task-5-report.md`.

The report must record base/head/paths, both REDs, timestamp conversion equations/origin, record schemas, queue capacities/drop/priority rules, reconnect and late behavior, C++/Node/Playwright evidence, any browser infrastructure escalation, deviations, and remaining Task 6/7 boundaries. Stay available for same-context Opus review fixes.
