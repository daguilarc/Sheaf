# gpt-5.5 — Working-Style Characterization

Based on 8 sessions from `failure_mode_manifest.json` spanning grades F, C, C, B, B, A, A, A
(complexity_composite 2.7–4.7 where available). All are `codex` implementer-role sessions except
one, which is a `kind: other` orchestrator session included as the manifest's only F.

Sessions read:
1. F · `add-dresden-4-synth-app__task-4` · `codex-019f4d0e-fc36-7532-9676-a8abe9bba126.md`
2. C · `add-browser-wasm-synth-runtime__task-6` · `codex-019f4063-c063-7a23-8803-8a914412c9ed.md`
3. C · `add-browser-wasm-synth-runtime__task-5` · `codex-019f4059-d5e6-78b1-ae5f-7bc2e66717cc.md`
4. B · `add-browser-wasm-synth-runtime__task-3` · `codex-019f4047-9462-77a0-bbda-3183a7cb7c14.md`
5. B · `add-synth-runtime-data-directory__task-4` · `codex-019f2fdb-00c5-7101-b84b-8bc0b8ab03c6.md`
6. A · `wt:d37c__task-4` (OLA/spectral DSP port) · `codex-019f3b29-e3bd-7b32-a2cf-213a1a54e767.md`
7. A · `add-browser-wasm-synth-runtime__task-8` · `codex-019f4078-b7d8-7fd2-8b6d-4a44b8f69b63.md`
8. A · `add-portable-modulator-visualizers__task-3` · `codex-019f5780-2555-7202-91fa-41d5ba958cff.md`

## Summary of characteristic behaviors

- **Heavy, ritualized brief/skill reading before touching code.** Almost every implementer
  session (2–8) opens with 3–7 `sed`/`cat` reads of superpowers skill files
  (`using-superpowers`, `test-driven-development`, `verification-before-completion`,
  `openspec-apply-change`, `git-workflow`) plus the task brief and OpenSpec proposal/design/spec/
  tasks files, often spending 20–40k input tokens before the first edit. A referenced
  `codex-tools.md` path is missing/broken in almost every session (2,3,4,5,7,8) and the model
  works around it silently each time rather than escalating, and re-derives the same workaround
  fresh per session (no memory of having solved it before).
- **True per-behavior red/green TDD on the two most granular tasks.** Sessions 2 (IDBFS storage)
  and 3 (Web MIDI adapter) show textbook micro-cycles: write one test file, run it, confirm it
  fails for the *intended* reason (missing module / missing symbol), implement the minimal
  fix, rerun to green, then repeat for the next slice (boot integration, then native ABI). This
  is the cleanest TDD discipline in the sample.
- **Coarser "batch tests, batch implementation" TDD on larger/less decomposable tasks.**
  Sessions 4 (static boot), 5 (engine startup wiring), 6 (OLA/spectral DSP port), and 8
  (portable visualizer composition) write a full slate of tests up front, run once to observe a
  single red signal (usually a compile/link failure), then implement the whole feature in one
  pass and rerun. Still test-first, but far less granular — the "red" step confirms *something*
  is missing rather than isolating each behavior.
- **Compulsive re-verification, sometimes redundantly.** Every implementer session reruns the
  focused test target and a broader suite (full JS suite, `native-tests`, `make test`) near the
  end, then reruns the *same* battery again after any small late edit (a compatibility tweak in
  session 3, an include cleanup in session 6, a checkbox correction in session 7) — even when the
  delta was a one-line change. Thorough but token-expensive.
- **Rigorous diff/scope self-check before every commit.** `git status`, `git diff --stat`,
  `git diff --check` (whitespace), and a manual `git diff -- <owned files>` review appear in
  every implementer session, typically run twice (once pre-report, once fresh pre-commit). Commits
  are consistently scoped to only the files the task brief assigned.
- **Recurring, unlearned stumble on gitignored report files.** In sessions 2, 3, 4, and 7, the
  model's first `git add <files + report>` is rejected because `.superpowers/sdd/*` is
  gitignored, and it has to retry with `git add -f`. This exact failure recurs across sibling
  tasks in the same change without the model ever front-loading a `git check-ignore` check first.
- **Busy-polling narration during slow builds.** When a long build runs (JUCE miniapp compile,
  full `make test`, a subagent review call), the model issues repeated 30–60s `write_stdin`
  polls each with a one-line "still compiling/linking/waiting" note rather than a single longer
  wait — seen heavily in sessions 5 (5 consecutive polls) and 7 (6 consecutive polls across a
  JUCE build and an Opus sub-review).
- **Honest, hedged completion reporting — including self-correction under review.** All four
  `add-browser-wasm-synth-runtime` sessions (2, 3, 4, 7) report `DONE_WITH_CONCERNS` rather than
  `DONE`, with a specific enumerated list of stubbed/deferred behavior. Session 7 goes further:
  after dispatching an Opus sub-review of its own OpenSpec checkbox sync, it accepts the
  reviewer's pushback and *un-checks* one item it had marked done, rather than defending its
  original claim.
- **The one F-grade session is structurally an outlier, not a TDD failure.** Session 1 is a
  `kind: other` root/orchestrator run (not a scoped SDD task-brief), dominated by
  `[CONTEXT COMPACTION]` markers and two `send_message` calls containing opaque encrypted
  payloads to a `/root` target. The actual implementation work is invisible in this timeline; the
  session ends with a confident, sweeping completion claim ("Implemented the complete Opus
  polish... Braid4 system tests: 16/16... DSP tests: all passed") with no visible test-run
  evidence in-band to back it, unlike every other session's habit of pasting fresh
  pass/fail output right before claiming done.

## Per-session notes

**Session 1 (F) — `add-dresden-4-synth-app__task-4`.** This is not a normal implementer run: it's
an interactive "why is this color wrong" debugging conversation that escalates into "audit all
color flow... make a wholistic spec... xagent have opus check it... implement it." Most of the
visible timeline is `[CONTEXT COMPACTION]` (turns 2, 4, 5) or encrypted `send_message` payloads
(turns 7–8) whose content this transcript cannot show. The final `SAY` claims a complete,
verified implementation (16/16 system tests, "DSP tests: all passed") but no test-run `CALL` is
visible anywhere in this timeline to substantiate it — a sharp contrast with every other session's
habit of showing the actual green output immediately before a completion claim. Given the F grade
(1 critical finding), this pattern — confident final summary without visible in-line verification
evidence — looks like the actual failure mode, even though it may simply be an artifact of what
happened during compaction.

**Session 2 (C) — `add-browser-wasm-synth-runtime__task-6` (IDBFS storage).** The cleanest TDD
in the sample. After the standard skill/brief-reading preamble (turns 1–6) and a read-only survey
of the existing browser JS/C++ surface (turns 5–6), it adds `storage.test.mjs` alone, runs it,
gets the expected `ERR_MODULE_NOT_FOUND` red (turn 8), writes the minimal `storage.js`, goes
green (turn 10). It then adds *further* red tests for boot integration (populate-sync gating,
turn 16), watches that fail for the right reason, implements, and iterates once more on a subtly
wrong test assertion (timing of the sync callback, turn 24) before going green. Finally it adds a
red native ABI test that fails at *link time* on missing exported symbols (turn 27), implements
the C++ ABI, and goes green (turn 29). Ends with two full fresh verification passes, a scoped
`git diff` review, the `git add` → ignored-report-file stumble → `git add -f` retry, and an
honest `DONE_WITH_CONCERNS` report calling out exactly which OpenSpec sub-items remain unwired.

**Session 3 (C) — `add-browser-wasm-synth-runtime__task-5` (Web MIDI adapter).** Same granular
red/green discipline as session 2. Notably it hits a real design problem mid-flight: the first
attempt at a native ABI red test would require linking the full browser host object, which pulls
in unrelated synth symbols (turn 12) — the model recognizes this, investigates the project's
static-lib build structure (turns 13–14), and re-scopes the test to link against the existing
library target instead of forcing a workaround. It also discovers the brief's target API doesn't
fully exist as described and explicitly notes it will report the real routing gap honestly rather
than overclaiming 5.3–5.5 (turn 15). Ends with the same double-verification, `build/` cleanup via
`rm -rf` (asked for escalated permission first), the ignored-report `git add -f` stumble again,
and a `DONE_WITH_CONCERNS` status.

**Session 4 (B) — `add-browser-wasm-synth-runtime__task-3` (static boot/worklet wiring).** Uses
the coarser batch pattern: writes all JS tests for runtime/static-preview at once (turn 9), runs
them once for a single red ("both JS modules are missing," turn 10), then implements the entire
runtime/boot/worklet/static-preview surface in one large pass (turn 11) and goes green on the
first attempt (turn 13). Distinctive extra step: it starts the actual static-preview server and
`curl`s each asset URL by hand to confirm headers/routing live (turns 16–18), discovers the wasm
asset legitimately 404s because `emcc` isn't installed, and reports that honestly rather than
faking success. Also shows a minor process-hygiene stumble: tries `kill <tool-session-id>` instead
of the OS PID (turn 20, fails), then correctly falls back to sending Ctrl-C via `write_stdin`
(turn 21). Same ignored-report `git add -f` pattern; ends `DONE_WITH_CONCERNS`.

**Session 5 (B) — `add-synth-runtime-data-directory__task-4` (engine startup wiring).** Also
batch-style: writes a full slate of engine tests in one edit (turn 8), gets a single compile-time
red on a missing method (turn 9), then implements engine + runtime wiring together and goes green
(turn 12). Distinctive risk: while a slow JUCE `make -C projects/synth/apps/miniapp` build is
still running, the model marks OpenSpec 4.1–4.5 complete (turn 20) *before* that build/verification
has actually finished — it only reruns the "exact required" command afterward once prompted by a
mid-task user status check ("Status check: please report briefly... Do not keep working silently
for a long time," turn 21), which the model answers accurately and non-evasively. This mid-run
marking-before-verifying is the one instance in the sample of checkbox/status claims potentially
running ahead of evidence, though it is corrected before the session ends. Also shows the heaviest
busy-polling: 5 consecutive 30s `write_stdin` no-op polls waiting on the JUCE build.

**Session 6 (A) — `wt:d37c__task-4` (OLA helpers + spectral model port from an external repo).**
Uses `update_plan` to track an explicit 5-step TDD plan (add tests → red → implement OLA →
implement spectral → verify), which none of the other sessions do. Batch-style red (one focused
compile red on missing APIs, turn 9), then implements both headers, discovers real compile errors
on the first green attempt (template lookup issues, an overly strict reference, turn 15) and
fixes them before rerunning. Notably patient with slow builds: lets a full `make -C projects/synth
test` run for several minutes via repeated `write_stdin` polls (turns 19–23) rather than
truncating early. After first commit, deliberately re-invokes
`superpowers:verification-before-completion` and reruns the focused suite *again* post-commit
(turn 31) purely to ground the final status in fresh evidence — the most conspicuous instance of
"verify twice" in the sample.

**Session 7 (A) — `add-browser-wasm-synth-runtime__task-8` (verification + OpenSpec checkbox
sync, no new code).** A pure verification/audit task: runs the full command battery (browser
native tests, JS unit + smoke suites, full synth `make test`, the JUCE miniapp test target, and
`openspec validate/status`), waiting through a very long JUCE build via ~6 consecutive polls (turns
10–16). It then reads the actual implementation (not just tests) to decide which of 37 OpenSpec
checkboxes are honestly checkable, deliberately marks only 14/37 (turn 23), and dispatches an
Opus sub-agent code review of its own diff (turns 30–34). When Opus flags one checked item (5.1)
as overly generous, the model accepts the finding and *unchecks* it rather than arguing (turn 35)
— a genuine self-correction rather than performative agreement. Also surfaces and reports a
missing required script (`scripts/review-package`) rather than silently skipping that step (turns
27–29). Same ignored-report `git add -f` pattern recurs a third time in this sample.

**Session 8 (A) — `add-portable-modulator-visualizers__task-3` (encoder composition).** Notable
for catching and correctly handling a stale brief: the brief references a `FocusEncoder` API that
does not exist in the checkout (turn 12), and rather than inventing it or stalling, the model
greps for the real production entry point (`ParamPush`) and explicitly calls out the discrepancy
("One brief detail appears stale," turn 13) before writing tests against the real API. TDD here is
granular per-surface: a portable-tree guard test (already green, used as a regression guard, turn
18), then app-level system tests that fail for the intended reason (missing visualizer node, turn
21), then minimal implementation and a full fresh rerun of all three binaries (turns 24–27),
repeated a second time immediately before commit (turns 30–33). Ends `DONE`, with no concerns
flagged — the only session in the sample with zero deferred/concern items in its final report.
