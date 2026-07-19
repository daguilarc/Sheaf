# claude session agent-aaee4360a4f278a13
kind: reviewer  model: claude-sonnet-5
task keys: {"worktree": "silly-meninsky-138d3d"}

## Prompt (truncated)
Working dir: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d (git worktree, branch claude/silly-meninsky-138d3d).

Fix one Critical reviewer finding, second round of the same race class.

Finding: `MidiPanel::Slot0Endpoints()` (projects/synth/runtime/MidiPanel.hpp:~332) reads `engine_.LiveInstrument().controllers` WITHOUT `audioDeviceStateMutex_`, from production message-thread paths (`Refresh()`, `ReopenPersistedEndpoints()`), while the audio thread mutates `instrumentConfig_` under that mutex via ApplyPatchMessage. The prior fix (commit 6d86492) fixed `RebuildMidiProcessors` but this reader remains unlocked.

Fix properly rather than point-patching: in projects/synth/include/synth/Engine.hpp add a locked read API — `MidiInstrumentConfig InstrumentSnapshot() const` (copy of `instrumentConfig_` taken under `audioDeviceStateMutex_`; the mutex member may need `mutable`). Then:
- Make `MidiPanel::Slot0Endpoints()` (and any other MidiPanel/live readers of `LiveInstrument()` on paths concurrent with running audio) use `InstrumentSnapshot()`.
- Audit ALL remaining `LiveInstrument()` callers (`grep -rn "LiveInstrument()" projects/synth`): each must either (a) run before audio starts (Initialize/startup), (b) hold the lock, or (c) switch to `InstrumentSnapshot()`. Tighten `LiveInstrument()`'s doc comment to state exactly when it is legal (e.g. "pre-audio initialization or under audioDeviceStateMutex_ only; running-state readers use InstrumentSnapshot()"). Test-support code (SynthRig single-threaded harness) may keep direct reads — note that in the comment audit if applicable.

Add/extend an engine test asserting `InstrumentSnapshot()` returns a deep copy equal to the live instrument and that mutating the snapshot does not affect the live one. Run `make -C projects/synth build test` (green, zero warnings) and `make -C projects/synth miniapp` (links). Commit: `fix(synth): locked instrument snapshot for message-thread readers` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

Append fix report to /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md. Final message: status, commit hash, one-line test summary, plus the caller-audit table (caller → a/b/c disposition).

## Turn 1  (output_tokens=16004)
- SAY: I'll start by exploring the relevant files to understand the current state before making changes.
- CALL Bash: grep -n "LiveInstrument\|audioDeviceStateMutex_\|instrumentConfig_" projects/synth/include/synth/Engine.hpp
  OUT: 50:        , instrumentConfig_()
79:        context_.instrument = &instrumentConfig_;
97:    //   4a. snapshot defaultInstrumentConfig_ = instrumentCo
- CALL Bash: grep -rn "LiveInstrument()" projects/synth
  OUT: projects/synth/include/synth/Engine.hpp:431:    MidiInstrumentConfig& LiveInstrument() { return instrumentConfig_; }
projects/synth/include/synth/Engi
- SAY: Now let's look at the Engine.hpp file in detail around the relevant sections.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: 415	    App& Application() { return app_; }
416	    AppContext& Context() { return context_; }
417	    ParameterManager& Manager() { return manager_; 
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: 1	#pragma once
2	
3	// synth_runtime::MidiPanel — the JUCE-side MIDI device management panel for
4	// the runtime shell (Plan 3 Task 3). Ports the old
- SAY: Now let's look at Slot0Endpoints and the surrounding readers in MidiPanel.hpp:
- CALL Bash: grep -n "Slot0Endpoints\|LiveInstrument\|Refresh()\|ReopenPersistedEndpoints" projects/synth/runtime/MidiPanel.hpp
  OUT: 16:// instrument (engine.LiveInstrument().controllers[0].input/output), via
31:// engine.SetMidiProcessorsRebuiltCallback([this]{ panel.ReopenPersiste
- CALL Read: {"__unparsedToolInput": {"raw": "{\"file_path\": \"/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp\", \"offset\": 190, g\u00fcltig, \"limit\": 200}", "le
  OUT: <tool_use_error>InputValidationError: Read was called with input that could not be parsed as JSON.
You sent (first 148 of 148 bytes): {"file_path": "/
- SAY: That error was a tool artifact glitch, let me retry properly.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: 190	        statusLabel_.setBounds(area.reduced(4));
191	    }
192	
193	    // Re-enumerates available devices, repopulates the combo boxes, and
194	 
- SAY: Now I understand the shape. Let's look at the full Engine.hpp around the mutex declaration and MidiInstrumentConfig type to design `InstrumentSnapshot()`.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: 780	
781	    // Members are declared in dependency order: buses reference the manager,
782	    // PatchManager references the buses.
783	    Parameter
- SAY: Good, `audioDeviceStateMutex_` is already `mutable`. Now let's check `AudioDeviceSnapshot()` for the existing pattern to follow, and check the commit 6d86492 for style reference.
- CALL Bash: grep -n "AudioDeviceSnapshot" projects/synth/include/synth/Engine.hpp | head -5
  OUT: 506:    // AudioDeviceSnapshot/DrainPatchInputBus). Replaces the old mutable
521:    AudioDeviceState AudioDeviceSnapshot() const {
811:    // reads v
- CALL Bash: git show 6d86492 --stat && echo "---" && git show 6d86492 | head -150
  OUT: commit 6d86492b4b927853f10832ee58d8bf14b1064d7c
Author: joyo <joyofresh@gmail.com>
Date:   Thu Jul 2 19:35:31 2026 -0700

    fix(synth): snapshot ins
- SAY: Now let's see `AudioDeviceSnapshot()` for the precise pattern to mirror:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: 515	
516	    // Host API: returns a locked copy of the current audio device state.
517	    // Safe to call from the message thread at any time (includ
- SAY: This is a perfect model to mirror `InstrumentSnapshot()` after. Now let's check the SynthRig test harness to understand caller (c) disposition:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/support/SynthRig.hpp
  OUT: 170	
171	    App& Application() { return engine_.Application(); }
172	    synth::Engine<App>& Engine() { return engine_; }
173	
174	    // Test-suppor
- SAY: This confirms SynthRig is a single-threaded test harness — disposition (c-test-support), explicitly allowed to keep direct writes. Now let's check the engine_tests.cpp callers to classify them (they're likely pre-audio-start / single-threaded test contexts too). Let's check test context around a few of the sites, and also check MidiPanel.hpp's second Refresh (line 597 area belongs to a different class perhaps).
- CALL Bash: grep -n "^class\|^struct" projects/synth/runtime/MidiPanel.hpp
  OUT: 95:class EngineForwardingMidiInProcessor final : public synth::MidiInProcessor {
115:class MidiPanel : public juce::Component {
529:class AudioPanel :
- CALL Read: {"__unparsedToolInput": {"raw": "{\"file_path\": \"/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/engine_tests.cpp\", \"offset\": 1285,1360}", "len": 133}}
  OUT: <tool_use_error>InputValidationError: Read was called with input that could not be parsed as JSON.
You sent (first 133 of 133 bytes): {"file_path": "/
- SAY: Good — only `MidiPanel` class has the `LiveInstrument()` calls in runtime code (all within `MidiPanel`, not `AudioPanel`). Now let's read the engine_tests.cpp usages properly.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/engine_tests.cpp
  OUT: 1285	    REQUIRE_TRUE(engine.AudioDeviceSnapshot().outputDeviceName == "Interface C");
1286	    REQUIRE_TRUE(callbackCalls == 0);
1287	    engine.Mess
- SAY: These test-file uses are single-threaded test code, no audio thread actually running concurrently (Prepare/ProcessBlock called synchronously in test driver) — same disposition as SynthRig: test-only, direct reads acceptable. This confirms the classification. Now let's check `Context().instrument` (AppContext raw pointer) since that's also relevant background but not literally `LiveInstrument()` — out of scope per the finding, which is specifically about `LiveInstrument()` callers.

Now let's implement the fix. First, add `InstrumentSnapshot()` to Engine.hpp:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: 421	    MidiInProcessor* MidiInputProcessor() { return midiProcessors_.input.get(); }
422	
423	    // Message-thread read of the live instrument (smi-
- SAY: Now let's write the updated doc comment and add the new `InstrumentSnapshot()` method:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp has been updated successfully. (file state 
- SAY: Now let's also update the `instrumentConfig_` member doc comment mentioning `LiveInstrument()/EditInstrument()`:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: 808	    MessageInBus midiBus_;
809	    ParameterMessageOutBus parameterMessageOutBus_;
810	    PatchMessageInBus patchInputBus_;
811	    MessageOutBus
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp has been updated successfully. (file state 
- SAY: Now let's also update the mutex doc comment that lists the readers/writers:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: 828	    // after app_.Init(&context_) returns and before any startup patch applies
829	    // (see the Initialize() binding-order comment, step 4a). E
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/Engine.hpp has been updated successfully. (file state 
- SAY: Now let's fix `MidiPanel::Slot0Endpoints()`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp has been updated successfully. (file state is 
- SAY: Now let's update the class-level doc comment at the top of MidiPanel.hpp that references `engine.LiveInstrument().controllers[0]...` since Slot0Endpoints now reads via snapshot (writes still go through EditInstrument, which is correct/locked):
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: 14	//
15	// Device open/close records identifiers into slot 0 of the engine's live
16	// instrument (engine.LiveInstrument().controllers[0].input/outp
- SAY: This comment is fine as-is since it's describing the write path via `EditInstrument`, which is still accurate (the mention of `LiveInstrument()` there is just referencing the conceptual location, and writes correctly go through `EditInstrument`). Let me tweak it slightly for precision though, since it could be read as implying direct reads too:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp has been updated successfully. (file state is 
- SAY: Now let's build the caller audit. Let's re-grep to confirm all callers after our edit:
- CALL Bash: grep -rn "LiveInstrument()" projects/synth
  OUT: projects/synth/include/synth/Engine.hpp:440:    MidiInstrumentConfig& LiveInstrument() { return instrumentConfig_; }
projects/synth/include/synth/Engi
- SAY: MidiPanel.hpp's actual call is now gone (only comment mentions remain), which is correct. All other call sites are in `engine_tests.cpp` (test file, single-threaded harness driving the engine directly, no concurrent audio thread) and `SynthRig.hpp` (explicitly test-support). Let's confirm the SynthRig comment about test-support is already adequately noted (it already is, per the doc block we read). Now let's add the engine test for `InstrumentSnapshot()`. Let's look at the test file structure near the existing RebuildMidiProcessors test for conventions:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/engine_tests.cpp
  OUT: 1560	        instrument.controllers.front().config.encoderOutput = synth::EncoderMidiOutConfig{};
1561	    });
1562	    REQUIRE_TRUE(engine.LiveInstru
- SAY: Let's check what equality means for `MidiInstrumentConfig` / `MidiControllerSlot` (does it have `operator==`?) so we can write a proper deep-equal assertion.
- CALL Bash: grep -rn "struct MidiInstrumentConfig\|struct MidiControllerSlot\|operator==" projects/synth/include/synth/*.hpp | grep -i "instrument\|controllerslot\|midiendpointref\|midicontrollerprofileconfig"
  OUT: projects/synth/include/synth/MidiController.hpp:507:struct MidiControllerSlot {
projects/synth/include/synth/MidiController.hpp:519:struct MidiInstrum
- SAY: No `operator==`. Let's check field structure so we can compare field-by-field.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp
  OUT: 495	    bool systemMessages;
496	    bool analogs;
497	};
498	
499	MidiKindSupport KindSupport(MidiProfileKind kind);
500	
501	struct MidiEndpointRef 
- SAY: No `operator==` on any of these types. I'll compare the fields we can (name, kind, endpoint refs, controllers.size(), and encoderInput presence) similar to what other tests do, plus mutate-independence check. Let's write the test:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/engine_tests.cpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/engine_tests.cpp has been updated successfully. (file state is
- SAY: Now let's build and run tests.
- CALL Bash: make -C projects/synth build test 2>&1 | tail -150
  OUT: 19:41:23 0 MidiInput midi 1956
19:41:23 0 Audio audio 1957
19:41:23 0 MidiInput midi 1957
19:41:23 0 Audio audio 1958
19:41:23 0 MidiInput midi 1958
1
- SAY: All tests pass, including the new `engine_instrument_snapshot_is_deep_copy_equal_to_live_instrument` test. Let's check for build warnings specifically and confirm the full command exit code:
- CALL Bash: make -C projects/synth build test 2>&1 | grep -i "warning\|error" | grep -v "^19:" | head -50; echo "EXIT_CHECK_DONE"
  OUT: EXIT_CHECK_DONE
- SAY: No warnings or errors. Now let's run the miniapp target to confirm it links:
- CALL Bash: make -C projects/synth miniapp 2>&1 | tail -60
  OUT: /Applications/Xcode.app/Contents/Developer/usr/bin/make -C apps/miniapp
c++ -I/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth
- SAY: Miniapp linked successfully. Let's also check the runtime target builds since MidiPanel.hpp lives in `runtime/` (make sure it's exercised too):
- CALL Bash: grep -rn "MidiPanel.hpp" projects/synth/apps 2>/dev/null; grep -rln "MidiPanel" projects/synth --include=Makefile* -r; find projects/synth -iname "Makefile*" | xargs grep -l "runtime" 2>/dev/null
  OUT: projects/synth/apps/miniapp/README.md:35:  come from `synth_runtime::MidiPanel` (`projects/synth/runtime/MidiPanel.hpp`).
projects/synth/apps/miniapp/
- SAY: Good — the miniapp build already compiles `MidiPanel.hpp` (confirmed by the include path `-I.../runtime` and the README noting the miniapp uses `synth_runtime::MidiPanel`), and it linked cleanly with no warnings under `-Wall -Wextra -Wpedantic`. That's our confirmation the `Slot0Endpoints()` change compiles correctly in the real runtime target.

Now let's verify the diff overall before committing:
- CALL Bash: git status --short && echo --- && git diff --stat
  OUT:  M projects/synth/include/synth/Engine.hpp
 M projects/synth/runtime/MidiPanel.hpp
 M projects/synth/tests/engine_tests.cpp
---
 projects/synth/includ
- SAY: Let's review the full diff once more for sanity before committing.
- CALL Bash: git diff
  OUT: diff --git a/projects/synth/include/synth/Engine.hpp b/projects/synth/include/synth/Engine.hpp
index bf95721..5bb42b6 100644
--- a/projects/synth/incl
- SAY: Let me fix a small wording glitch in the class-level MidiPanel.hpp comment — the "midiInstrument" got split awkwardly across lines:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: 1	#pragma once
2	
3	// synth_runtime::MidiPanel — the JUCE-side MIDI device management panel for
4	// the runtime shell (Plan 3 Task 3). Ports the old
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp has been updated successfully. (file state is 
- SAY: Let's re-run the build/test quickly to make sure this comment-only edit didn't break anything (should be a no-op but let's confirm compile cleanliness once more, fast).
- CALL Bash: make -C projects/synth build test 2>&1 | tail -20
  OUT: build/rig_tests
[PASS] rig_runs_blocks_and_captures_output
[PASS] rig_turn_reaches_parameter_through_production_bus
[PASS] rig_run_samples_and_seconds
- SAY: All green. Now let's commit.
- CALL Bash: git add projects/synth/include/synth/Engine.hpp projects/synth/runtime/MidiPanel.hpp projects/synth/tests/engine_tests.cpp && git status --short
  OUT: M  projects/synth/include/synth/Engine.hpp
M  projects/synth/runtime/MidiPanel.hpp
M  projects/synth/tests/engine_tests.cpp
- CALL Bash: git commit -m "$(cat <<'EOF'
fix(synth): locked instrument snapshot for message-thread readers

MidiPanel::Slot0Endpoints() read engine_.LiveInstrument().controllers
without audioDeviceStateMutex_ from production message-thread paths
(Refresh(), ReopenPersistedEndpoints()), racing the audio thread's
  OUT: [claude/silly-meninsky-138d3d 0b9f1ca] fix(synth): locked instrument snapshot for message-thread readers
 3 files changed, 106 insertions(+), 17 delet
- CALL Bash: git log -1 --format="%H %s"
  OUT: 0b9f1cae92649a3d2b65af07f8e8b481a4b07b74 fix(synth): locked instrument snapshot for message-thread readers
- SAY: Now let's append the fix report.
- CALL Bash: ls -la /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/ 2>&1 | head -20
  OUT: total 864
drwxr-xr-x@ 19 joyo  staff     608 Jul  2 19:36 .
drwxr-xr-x@  3 joyo  staff      96 Jul  2 18:20 ..
-rw-r--r--@  1 joyo  staff       2 Jul 
- SAY: p1-task-4-report.md exists already (from the prior round's fix). Let's check its tail to see the format used, then append.
- CALL Bash: tail -80 /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md
  OUT: already documents it as guarding `instrumentConfig_` against exactly this
race: the audio-thread patch drain (`DrainPatchInputBus`, the `ProcessBlock`
- SAY: Now let's get the exact test counts for this round and append a new section documenting round 2.
- CALL Bash: make -C projects/synth build test 2>&1 | grep -c "^\[PASS\]"; make -C projects/synth build test 2>&1 | grep -c "^\[FAIL\]"
  OUT: 281
0
- SAY: 281 tests pass (280 prior + 1 new), 0 failures. Now let's append the round-2 report.
- CALL Bash: wc -l /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md
  OUT:      304 /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md
  OUT: 1	# Task 4 report: engine-owned instrument with serialized edits
2	
3	## Status: complete
4	
5	## Summary
6	
7	`Engine<App>` now owns the MIDI instrum
- SAY: Now let's append the round-2 fix report as a new section:
- CALL Bash: cat >> /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md << 'EOF'

---

# Round 2 addendum: `MidiPanel::Slot0Endpoints()` unlocked read (Critical)

## Status: complete

## Finding

`MidiPanel::Slot0Endpoints()` (`projects/synth/runtime/MidiPanel.hpp`, was
  OUT: done
- SAY: Let's verify the file is well-formed and check final git state:
- CALL Bash: tail -20 /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p1-task-4-report.md && echo --- && git status --short
  OUT: ## Verification

```
make -C projects/synth build test
```
Result: **281/281 tests pass** (280 pre-existing + 1 new), zero warnings,
zero errors (`-st
- SAY: The report file is untracked by git status changes shown as empty — let me check if `.superpowers/` is gitignored (it has a `.gitignore` in it), which is expected and fine since we just need to write the report, not commit it.
- CALL Bash: cat /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/.gitignore; git status --short --ignored=matching .superpowers 2>&1 | head -5
  OUT: *
!! .superpowers/sdd/.gitignore
!! .superpowers/sdd/p1-globals.md
!! .superpowers/sdd/p1-task-1-brief.md
!! .superpowers/sdd/p1-task-1-report.md
!! .
- SAY: Confirmed — `.superpowers/sdd/` is intentionally gitignored (report artifacts, not committed source). Everything is in order.

## Status: complete

**Commit:** `0b9f1cae92649a3d2b65af07f8e8b481a4b07b74` — `fix(synth): locked instrument snapshot for message-thread readers`

**Test summary:** `make -C projects/synth build test` → 281/281 tests pass (280 pre-existing + 1 new: `engine_instrument_snapshot_is_deep_copy_equal_to_live_instrument`), zero warnings, zero errors under `-Wall -Wextra -Wpedantic`. `make -C projects/synth miniapp` links clean and exercises the `MidiPanel.hpp` change.

**Call
