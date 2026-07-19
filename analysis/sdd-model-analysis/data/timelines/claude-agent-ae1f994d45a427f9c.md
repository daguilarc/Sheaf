# claude session agent-ae1f994d45a427f9c
kind: reviewer  model: claude-sonnet-5
task keys: {"change_dir": null, "task": "p3-task-2", "worktree": "silly-meninsky-138d3d"}

## Prompt (truncated)
Working dir: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d (git worktree, branch claude/silly-meninsky-138d3d). Fix four reviewer findings from the MidiConnectionManager task. Context files: .superpowers/sdd/p3-task-2-brief.md, .superpowers/sdd/p3-globals.md, .superpowers/sdd/p3-task-2-report.md.

1 (Critical — sink use-after-free): `MidiSender::Run()` (projects/synth/src/MidiController.cpp:~617) copies `sinks_[ix]` under the mutex, unlocks, then calls `sink->Send()`. `MidiConnectionManager` (runtime/MidiConnectionManager.hpp:~326) does `SetSink(ix, nullptr)` then destroys the output handler on shrink — an in-flight Send can use the freed handler. Fix in MidiSender: add a way to clear a sink that synchronizes with in-flight sends — e.g. track `sendingSinkIx_` (or a per-send generation) under the mutex; `SetSink(ix, nullptr)` (or a new `ClearSinkSync(ix)`) blocks on the CV until the worker is not mid-Send on that sink. Keep Send outside the lock for other sinks. Document the guarantee on the API ("after ClearSinkSync returns, the worker will never call that sink again"). Manager shrink path uses the synchronized clear BEFORE destroying handlers. Add a JUCE-free test: fake sink whose Send blocks on a latch; clear-sync from another thread must wait until the blocked Send completes, then handler destruction is safe (assert no call after clear returns; use the existing test patterns — this is thread-timing sensitive, use generous timeouts and run it 8x).

2 (Important — startup double-reconcile): Runtime wires `SetMidiProcessorsRebuiltCallback` before `engine.Initialize()` (runtime/Runtime.hpp:~91), so a startup-patch rebuild triggers `OnInstrumentRebuilt()` reconcile BEFORE `StartupReconcile()` (Runtime.hpp:~212) — violating the binding "ONE synchronous startup reconcile, then poller". Fix: add a `started_` gate to MidiConnectionManager — until `StartupReconcile()` runs, `OnInstrumentRebuilt()` only resizes handler/sink vectors and does NOT reconcile; StartupReconcile resizes, plans against empty state, executes, sets started_. Verify the rebuilt-callback ordering still handles post-startup patch loads (rebuild → reconcile) correctly.

3 (Important — manual opens lose device names): MidiPanel passes identifier-only (runtime/MidiPanel.hpp:~294, ~307) and ManualOpenInput/Output store `name=""` (MidiConnectionManager.hpp:~245, ~261). Stored endpoint refs MUST carry identifier+name (name fallback is how reconnect survives identifier churn). Thread the 

## Turn 1  (output_tokens=40708)
- SAY: I'll start by reading the context files to understand the task fully.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p3-task-2-brief.md
  OUT: 1	### Task 2: Per-controller handlers + plan executor (JUCE-free logic, runtime glue)
2	
3	**Files:**
4	- Create: `projects/synth/runtime/MidiConnecti
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p3-globals.md
  OUT: 1	# MIDI Instrument Config — Plan 3/4: Runtime Connection Lifecycle Implementation Plan
2	
3	> **For agentic workers:** REQUIRED SUB-SKILL: Use superp
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p3-task-2-report.md
  OUT: 1	# Plan 3 Task 2 report — per-controller connection manager with plan executor
2	
3	## Status: complete
4	
5	## What was built
6	
7	### JUCE-free exe
- SAY: This is a substantial multi-part fix task. Let me start by exploring the relevant source files to understand the current state before making changes.
- CALL mcp__ccd_session__mark_chapter: {"title": "Exploration", "summary": "Reading source files for MidiSender, MidiConnectionManager, MidiPanel"}
  OUT: Chapter marked: "Exploration". Continue your current work.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: 1	#include "synth/MidiController.hpp"
2	#include "synth/ThreadId.hpp"
3	
4	#include <algorithm>
5	#include <cmath>
6	#include <limits>
7	#include <str
- SAY: Let me find the actual `MidiSender::Run()` and `SetSink` implementations, plus the relevant manager and panel files.
- CALL Bash: grep -n "class MidiSender\|MidiSender::\|SetSink\|sinks_\|sendingSinkIx_\|Run()" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp | head -80
  OUT: 534:MidiSender::MidiSender(std::size_t capacity)
537:MidiSender::~MidiSender() {
541:void MidiSender::SetSink(std::size_t sinkIx, IMidiOutputSink* sin
- CALL Bash: grep -rn "class MidiSender\|SetSink\|sinks_" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp
  OUT: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp:213:class MidiSender {
/Users/joyo/Sheaf/.cl
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp
  OUT: 195	    const SystemButtonMidiAssociation* FindAssociation(const BasicMidi& midi) const;
196	    void PushStamped(MessageIn message);
197	
198	    Sys
- SAY: Now let's see the `MidiSender` implementation (`Run()`, `SetSink()`, `Stop()`):
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: 530	    message.timestamp = NextTimestamp();
531	    Push(message);
532	}
533	
534	MidiSender::MidiSender(std::size_t capacity)
535	    : queue_(capac
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: 630	            }
631	        }
632	    }
633	    {
634	        std::lock_guard lock(mutex_);
635	        running_ = false;
636	    }
637	    drainedC
- SAY: Now I understand the sink use-after-free issue. `inFlight_` tracks count but not which sink index. Let's design `sendingSinkIx_` tracking. Now let's look at `MidiConnectionManager.hpp` and `MidiPanel.hpp`.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 1	#pragma once
2	
3	// synth_runtime::MidiConnectionManager — per-controller MIDI device lifecycle
4	// owner (Plan 3 Task 2). Owns a vector of synth_
- SAY: Now let's look at `MidiPanel.hpp` and `Runtime.hpp`:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: 1	#pragma once
2	
3	// synth_runtime::MidiPanel — the JUCE-side MIDI device management panel for
4	// the runtime shell (Plan 3 Task 3, UI ownership u
- SAY: Interesting - the review says line ~294 and ~307 pass identifier-only, but current code calls `inputBox_.addItem(inputDevices_[ix].name, ix + 1)` — the name is available in `inputDevices_`/`outputDevices_`. Now let's look at `Runtime.hpp`:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/Runtime.hpp
  OUT: 1	#pragma once
2	
3	// synth_runtime::Runtime — the JUCE-side host shell over synth::Engine<App>
4	// (sar-7 and later). Owns the audio device, drives
- SAY: Now I understand issue 2 clearly: `SetMidiProcessorsRebuiltCallback` in the constructor calls `midiConnections_->OnInstrumentRebuilt()` unconditionally, and that method reconciles if `!reconciling_`. Since `reconciling_` starts false, and this happens during `engine_.Initialize()`'s startup-patch rebuild (before `StartupReconcile()` in `Start()`), it double-reconciles. Now let's look at `MidiReconcile.hpp` for existing types, and the test file for patterns.
- CALL Bash: find /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth -iname "*MidiReconcile*"
  OUT: <tool_use_error>InputValidationError: Bash failed due to the following issue:
An unexpected parameter `Bash` was provided</tool_use_error>
- CALL Bash: find /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth -iname "*MidiReconcile*"; echo "---"; find /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests -iname "*midi*"
  OUT: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/build/MidiReconcile.o
/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d
- CALL Bash: find /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth -iname "*.cpp" -path "*test*" | xargs grep -l "reconcile\|Reconcile" 2>/dev/null; echo "---all tests---"; find /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth -iname "*test*" -name "*.cpp"
  OUT: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_tests.cpp
/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-
- SAY: Let's find tests for MidiController.cpp (MidiSender) and the test-harness patterns used (assert macros, latch usage), plus the Makefile structure.
- CALL Bash: grep -rln "MidiSender" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/ /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/juce/ 2>/dev/null
  OUT: <tool_use_error>InputValidationError: Bash failed due to the following issue:
An unexpected parameter `Bash` was provided</tool_use_error>
- CALL Bash: grep -rln "MidiSender" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/ /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/juce/ 2>/dev/null
  OUT: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/rig_tests.cpp
/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d
- CALL Bash: grep -n "MidiSender\|latch\|Latch\|#include" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/rig_tests.cpp | head -50
  OUT: 1:#include "support/SynthRig.hpp"
7:#include <chrono>
8:#include <cmath>
9:#include <cstdint>
10:#include <exception>
11:#include <filesystem>
12:#inc
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/rig_tests.cpp
  OUT: 520	    rig.SendMidi(1, turn);
521	    rig.RunBlocks(8);
522	    REQUIRE_TRUE(rig.ParameterValue(rig.Application().betaId) > betaBefore);
523	}
524	
5
- SAY: Now let's find `FakeSink` and the test framework's macro conventions (TEST_CASE, REQUIRE_TRUE), plus the Makefile test wiring.
- CALL Bash: grep -rn "class FakeSink\|struct FakeSink" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/
  OUT: <tool_use_error>InputValidationError: Bash failed due to the following issue:
An unexpected parameter `Bash` was provided</tool_use_error>
- CALL Bash: grep -rn "class FakeSink\|struct FakeSink" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/; echo "---"; sed -n '1,50p' /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_executor_tests.cpp
  OUT: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/rig_tests.cpp:136:struct FakeSink final : synth::IMidiOutputSink {
---

- SAY: Good — this is the JUCE-free test pattern. Now let's find where MidiSender-level tests would go — is there a dedicated `midi_controller_tests.cpp` or should the new sender test be a new file? Let's check the Makefile.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/Makefile
  OUT: 1	CXX ?= clang++
2	CXXFLAGS ?= -std=c++20 -Wall -Wextra -Wpedantic -O2
3	CPPFLAGS ?= -Iinclude
4	BUILD_DIR := build
5	BUILD_SENTINEL := $(BUILD_DIR)/.
- SAY: Let's check `poller_tests.cpp` for the thread-timing test pattern (latch, etc.) since it's the most similar test to what I need for the sender clear-sync test:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/poller_tests.cpp
  OUT: 1	#include "synth/MidiDevicePoller.hpp"
2	#include "synth/ThreadId.hpp"
3	
4	#ifdef JUCE_MAJOR_VERSION
5	#error "synth module tests must not see JUCE 
- SAY: Now let's look at `MidiReconcile.hpp` for the `MidiConnectionState` etc. types (needed for finding 4's helper), and check `MidiDevicePoller.hpp` as a model for a small pure helper header.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiReconcile.hpp
  OUT: 1	#pragma once
2	
3	#include "synth/MidiController.hpp"
4	
5	#include <cstddef>
6	#include <functional>
7	#include <string>
8	#include <vector>
9	
10	
- SAY: Now let's check `MidiHandlers.hpp` for `MidiInHandler`/`MidiOutputHandler` `Open` signature (to understand how names come through), and check the `openInput`/`ManualOpenInput` name parameter needs.
- CALL Bash: find /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth -iname "MidiHandlers.hpp"
  OUT: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/juce/MidiHandlers.hpp
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/juce/MidiHandlers.hpp
  OUT: 1	#pragma once
2	
3	#include "synth/MidiController.hpp"
4	
5	#include <juce_audio_devices/juce_audio_devices.h>
6	
7	#include <cmath>
8	#include <memo
- SAY: Good — `Open()` already resolves `deviceName_` from the identifier via `AvailableDevices()`, so `InputDeviceName(ix)`/`OutputDeviceName(ix)` already returns the real name after open. That means `ManualOpenInput/Output` can read the name from the handler after a successful open, rather than needing the panel to pass it through. Let's check `reconcile_tests.cpp` briefly for the planner's stored-name matching to make sure I understand why `name=""` is a problem.
- CALL Bash: grep -n "name\|Name" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiReconcile.cpp | head -40
  OUT: 5:namespace synth {
7:namespace {
20:// Finds a present device by exact stored-name match (fallback when identifier misses), skipping
21:// devices al
- SAY: Confirmed: without a stored `name`, if the identifier changes (device unplugged/replugged with a new OS-assigned identifier), the name-fallback match can never fire, breaking reconnect. Now I have enough context. Let's plan out all four fixes.
- CALL mcp__ccd_session__mark_chapter: {"title": "Fix 1: Sink use-after-free", "summary": "Add ClearSinkSync to MidiSender with generation/in-flight tracking"}
  OUT: Chapter marked: "Fix 1: Sink use-after-free". Continue your current work.
- SAY: Let's check `ThreadId.hpp` and `Context`/`midiSender` type for API surface, then implement Fix 1.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp
  OUT: 1	#pragma once
2	
3	#include "synth/ParameterModulation.hpp"
4	
5	#include <array>
6	#include <chrono>
7	#include <condition_variable>
8	#include <cst
- SAY: Now let's implement the fix. I'll add `sendingSinkIx_` tracking (set while `Send()` is in-flight, protected by the mutex) and a `ClearSinkSync` method that blocks on the CV until the worker isn't mid-send on that sink.
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp has been updated successfully. (fil
- SAY: Now update the private members to track the currently-sending sink index:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiController.hpp has been updated successfully. (fil
- SAY: Now let's update the .cpp implementation. First `SetSink`, then add `ClearSinkSync`, then update `Run()`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp has been updated successfully. (file state is
- SAY: Now update `Run()` to track `sendingSinkIx_` around the unlocked `Send()` call:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: 616	    std::unique_lock lock(mutex_);
617	    return drainedCv_.wait_for(lock, timeout, [this] { return size_ == 0 && inFlight_ == 0; });
618	}
619	

- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp has been updated successfully. (file state is
- SAY: Now let's update `Stop()` to also reset `sendingSinkIx_` and notify `sendingCv_`, for safety/consistency (in case `ClearSinkSync` is waiting when `Stop()` is called):
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: 559	    // old sink pointer for, in its local `sink` variable) before we cleared
560	    // sinks_ above -- sendingSinkIx_ == sinkIx is exactly that c
- SAY: This is fine — `Run()`'s loop already notifies `sendingCv_` on every exit path (both the normal break-out block and after the loop, via the trailing `sendingCv_.notify_all()`), and `sendingSinkIx_` resets to `kMaxSinks` before that break since the break only happens when `size_ == 0` (no dequeued entry in flight at that point). Let's verify `Stop()` doesn't need direct changes — checking the full body:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiController.cpp
  OUT: 575	void MidiSender::Stop() {
576	    {
577	        std::lock_guard lock(mutex_);
578	        if (!running_ && !thread_.joinable()) {
579	            
- SAY: This is fine as-is — `Stop()` joins the thread, so by the time it returns the worker is fully done and `sendingSinkIx_` is `kMaxSinks`. No `ClearSinkSync` caller would be blocked waiting past `Stop()`'s join since `Run()` always notifies `sendingCv_` before exiting. Good, Fix 1's core implementation is done. Now let's update the manager's shrink path (`ResizeToControllerCount`) and close paths to use `ClearSinkSync` before handler destruction/close.
- CALL mcp__ccd_session__mark_chapter: {"title": "Fix 2: Startup double-reconcile gate", "summary": "Add started_ flag to MidiConnectionManager; wire ClearSinkSync into manager"}
  OUT: Chapter marked: "Fix 2: Startup double-reconcile gate". Continue your current work.
- SAY: Now let's update `MidiConnectionManager.hpp` for both Fix 1 (use `ClearSinkSync` before handler destruction) and Fix 2 (the `started_` gate). Let's look at all sink-clearing call sites in the manager:

Sites needing `ClearSinkSync` instead of `SetSink(ix, nullptr)`:
1. Destructor (line ~136-139) — before `outputHandlers_[ix]->Close()`
2. `ResizeToControllerCount` shrink path (line ~326-332) — before `outputHandlers_[ix]->Close()` (and vector resize destroys the unique_ptr)
3. `CloseOutput` (line ~447-454) — manual/plan-driven close

Let's check if `CloseOutput` closing needs sync too — since i
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: Now the shrink path in `ResizeToControllerCount`:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 313	    }
314	
315	    // Grows/shrinks inputHandlers_/outputHandlers_/state_.controllers to
316	    // engine_.MidiControllerCount(), preserving exis
- SAY: This is the exact bug the review calls out — `SetSink(ix, nullptr)` followed by `outputHandlers_.resize(count)`, which destroys the trailing unique_ptrs. Fix this with `ClearSinkSync`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: Now `CloseOutput` (used by `ManualCloseOutput` and the plan executor's `closeOutput` op) — the handler is not destroyed here, just closed, but for consistency and defense-in-depth let's check if that's also worth synchronizing. Since `MidiOutputHandler::Close()` is itself mutex-guarded against concurrent `Send()`, this is not a use-after-free risk. I'll leave `CloseOutput` using `SetSink(ix, nullptr)` since no destruction follows, but let's double check by reading it:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 450	            }
451	        }
452	        return opened;
453	    }
454	
455	    void CloseInput(std::size_t ix) {
456	        if (ix < inputHandlers
- SAY: That's correct as-is (no destruction follows `CloseOutput`, and `MidiOutputHandler` itself is safe against concurrent `Send()`/`Close()`). Now let's do Fix 2 — the `started_` gate.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 146	            }
147	        }
148	    }
149	
150	    MidiConnectionManager(const MidiConnectionManager&) = delete;
151	    MidiConnectionManager& op
- SAY: Now let's apply the `started_` gate:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: Now update `OnInstrumentRebuilt()`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: Now add the `started_` member and check `ManualOpenInput/Output` — those set `reconciling_` around `UpdateRef` and rely on `OnInstrumentRebuilt`'s guard; since manual opens only happen after startup (UI-driven), the `started_` gate won't break them, but let's verify they're never called pre-startup. Let's look at the member declarations:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 515	        // EditInstrument's rebuild replaced midiProcessors_ (and thus
516	        // rebuilt every forwarding target); reinstall this slot's forw
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 534	    void Resync(std::size_t ix) {
535	        if (ix < inputHandlers_.size() && inputHandlers_[ix]) {
536	            inputHandlers_[ix]->SetProce
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: Now let's also update the class doc comment at the top of the file mentioning the ordering to reflect the `started_` gate, for consistency. Let's check that section:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 1	#pragma once
2	
3	// synth_runtime::MidiConnectionManager — per-controller MIDI device lifecycle
4	// owner (Plan 3 Task 2). Owns a vector of synth_
- SAY: Let's add a paragraph documenting the `started_` gate binding right after the EditInstrument re-entrancy paragraph:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: Now Fix 3: manual opens lose device names. Let's look at how `ManualOpenInput/Output` and the panel interact more closely.
- CALL mcp__ccd_session__mark_chapter: {"title": "Fix 3: Manual open device names", "summary": "Thread device name from panel through ManualOpenInput/Output into stored ref"}
  OUT: Chapter marked: "Fix 3: Manual open device names". Continue your current work.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 245	    void OnInstrumentRebuilt() {
246	        ResizeToControllerCount();
247	        if (!started_ || reconciling_) {
248	            return;
249	 
- SAY: Now let's add a `name` parameter to `ManualOpenInput`/`ManualOpenOutput` and thread it into `UpdateRef`:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 282	    bool ManualOpenInput(std::size_t ix, const std::string& identifier) {
283	        if (ix >= inputHandlers_.size() || identifier.empty()) {
284
- SAY: Now let's add a `name` parameter, threading through to `UpdateRef`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: Now let's update `MidiPanel.hpp`'s `ToggleInput`/`ToggleOutput` to pass the device name:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: 272	
273	    juce::String SelectedInputIdentifier() const {
274	        const int ix = inputBox_.getSelectedId() - 1;
275	        return ix >= 0 && ix
- SAY: I'll add matching `SelectedInputName()`/`SelectedOutputName()` helpers and pass them through:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp has been updated successfully. (file state is 
- SAY: Now let's do Fix 4: extract the resize bookkeeping decision into a pure JUCE-free helper and unit test it.
- CALL mcp__ccd_session__mark_chapter: {"title": "Fix 4: Resize helper + unit tests", "summary": "Extract pure resize-decision helper into MidiReconcile.hpp, add tests"}
  OUT: Chapter marked: "Fix 4: Resize helper + unit tests". Continue your current work.
- SAY: Let's look at `MidiReconcile.cpp` to see its current structure, so I can add a `PlanConnectionResize` helper there consistently:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiReconcile.cpp
  OUT: 1	#include "synth/MidiReconcile.hpp"
2	
3	#include <unordered_set>
4	
5	namespace synth {
6	
7	namespace {
8	
9	// Finds a present device by exact ide
- SAY: Now I'll design the pure resize-decision helper. It needs to answer: given old count N, new count M, which indices to close/destroy input handlers, which to close/destroy output handlers, and which sinks to clear-sync (same as output-close indices, since sinks are 1:1 with output slots). Let's design the struct and function signature, then add it to `MidiReconcile.hpp`/`.cpp`.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_executor_tests.cpp
  OUT: 40	            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
41	            throw std::runtime_error(oss.str()); \
42	       
- SAY: Now let's add `MidiConnectionResize` (a plan struct + a pure function `PlanMidiConnectionResize`) to `MidiReconcile.hpp`. This models "given old count and new count, which indices are closing (both input and output) — since all indices >= newCount get closed regardless of open state, this is a straightforward range, but the important part is being explicit and testable, including the same-size no-op case."
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiReconcile.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/include/synth/MidiReconcile.hpp has been updated successfully. (file
- SAY: Now implement it in `MidiReconcile.cpp`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiReconcile.cpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/src/MidiReconcile.cpp has been updated successfully. (file state is 
- SAY: Now let's wire `MidiConnectionManager::ResizeToControllerCount` to use this helper:
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 327	    }
328	
329	    void ManualCloseInput(std::size_t ix) {
330	        CloseInput(ix);
331	        EnsureStateSlot(ix);
332	        state_.control
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 396	                // comment (include/synth/MidiController.hpp).
397	                if (synth::MidiSender* sender = engine_.Context().midiSender; s
- SAY: Now let's rewrite `ResizeToControllerCount` to call `synth::PlanMidiConnectionResize` for the closing/growing index sets:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp has been updated successfully. (fi
- SAY: I need to add the `#include "synth/MidiReconcile.hpp"` (already present) — let's verify it's already included at the top of the manager file:
- CALL Bash: grep -n "#include" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiConnectionManager.hpp
  OUT: 79:#include "synth/AsyncLogger.hpp"
80:#include "synth/Engine.hpp"
81:#include "synth/MidiController.hpp"
82:#include "synth/MidiDevicePoller.hpp"
83:
- SAY: Good, already included. Now let's write the unit tests for `PlanMidiConnectionResize` in `reconcile_executor_tests.cpp` (this is the JUCE-free test binary already wired in the Makefile). Let's view the end of that file for `main()` placement:
- CALL Bash: wc -l /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_executor_tests.cpp; tail -40 /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_executor_tests.cpp
  OUT:      378 /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_executor_tests.cpp
    plan.actions.push_back(Action
- SAY: Now let's insert the resize-plan tests before `int main()`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_executor_tests.cpp
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/reconcile_executor_tests.cpp has been updated successfully. (f
- SAY: Now let's create the new sender clear-sync test. Let's check whether there's a dedicated `midi_controller_tests.cpp`, or if I should add a new test binary. Since `MidiSender` lives in JUCE-free core (`MidiController.hpp`/`.cpp`), it should be its own test file wired into the Makefile.
- CALL Bash: grep -n "MidiSender\|IMidiOutputSink" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/instrument_tests.cpp 2>/dev/null | head -20
  OUT: (Bash completed with no output)
- SAY: No existing coverage there. I'll create a new `tests/midi_sender_tests.cpp` JUCE-free test binary, following the same pattern as `poller_tests.cpp`, with a fake sink whose `Send()` blocks on a latch.
- CALL Write: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/midi_sender_tests.cpp
  OUT: File created successfully at: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/tests/midi_sender_tests.cpp (file state is curr
- SAY: Now let's wire this new test binary into the Makefile:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/Makefile
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/Makefile has been updated successfully. (file state is current in yo
- SAY: Now let's check whether the test binaries need pthread linking (thread tests) — check existing linking flags for e.g. `poller_tests`:
- CALL Bash: grep -n "pthread\|CXXFLAGS\|LDFLAGS" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/Makefile
  OUT: 2:CXXFLAGS ?= -std=c++20 -Wall -Wextra -Wpedantic -O2
37:	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@
40:	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@
43
- SAY: No explicit `-lpthread` linking anywhere (macOS clang links libc++'s threading by default). `poller_tests` already uses `std::thread`/mutex without extra flags, so this pattern is fine on this platform. Now add the build rule and wire into `test`:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/Makefile
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/Makefile has been updated successfully. (file state is current in yo
- SAY: Now let's build and run tests.
- CALL mcp__ccd_session__mark_chapter: {"title": "Build and test", "summary": "Run make build test, fix compile errors, run sender test 8x"}
  OUT: Chapter marked: "Build and test". Continue your current work.
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && rm -rf build && make build test 2>&1 | tail -150
  OUT: 21:52:03 0 Audio audio 1985
21:52:03 0 MidiInput midi 1985
21:52:03 0 Audio audio 1986
21:52:03 0 MidiInput midi 1986
21:52:03 0 Audio audio 1987
21:5
- SAY: Everything passes. Let's check for warnings and confirm the whole output (checking the top for compile warnings):
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && rm -rf build && make build test 2>&1 | grep -iE "warning|error" | head -50; echo "---done---"
  OUT: ---done---
- SAY: Zero warnings, zero errors. Now let's run the new sender test binary 8x as instructed:
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && for i in $(seq 1 8); do echo "=== run $i ==="; ./build/midi_sender_tests || echo "RUN $i FAILED"; done 2>&1
  OUT: === run 1 ===
[PASS] enqueued_message_is_delivered_to_registered_sink
[PASS] clear_sink_sync_waits_for_in_flight_send_before_returning
[PASS] clear_si
- SAY: All 8 runs passed cleanly. Now let's build the apps target (miniapp, JUCE link check):
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && rm -rf apps/miniapp/build && make apps 2>&1 | tail -150
  OUT: /Applications/Xcode.app/Contents/Developer/usr/bin/make -C apps/miniapp
mkdir -p /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/sy
- SAY: Links cleanly, no warnings/errors. Let's double check for warnings specifically in this output:
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && rm -rf apps/miniapp/build && make apps 2>&1 | grep -iE "warning|error"; echo "---done---"; ls apps/miniapp/build/SynthMiniapp.app 2>&1
  OUT: ---done---
Contents
- SAY: Clean build, app produced. Now let's verify the `MidiPanel.hpp`'s default-argument change didn't break call sites, and double check `Runtime.hpp` doesn't need edits related to Fix 2 (it already wires unconditionally per the brief — the fix lives entirely in the manager). Let's re-check `Runtime.hpp`'s comments are still accurate:
- CALL Bash: grep -n "ManualOpenInput\|ManualOpenOutput" /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth -r
  OUT: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/MidiPanel.hpp:20:// (ManualOpenInput/ManualOpenOutput/ManualCloseInpu
- SAY: Good, these compiled cleanly as part of the `apps` build (MidiPanel.hpp is JUCE-code, exercised in the miniapp build). Now let's double check the `MidiConnectionState`/`MidiConnectionResizePlan` naming for consistency and verify no stray issues. Let's view the final diff of all files to review holistically.
- CALL Bash: git status --short
  OUT:  M projects/synth/Makefile
 M projects/synth/include/synth/MidiController.hpp
 M projects/synth/include/synth/MidiReconcile.hpp
 M projects/synth/runt
- SAY: Let's view the full diff for a final review pass before committing:
- CALL Bash: git diff -- projects/synth/include/synth/MidiController.hpp projects/synth/src/MidiController.cpp
  OUT: diff --git a/projects/synth/include/synth/MidiController.hpp b/projects/synth/include/synth/MidiController.hpp
index 87ab61b..cb26c11 100644
--- a/pro
- SAY: This is correct. One subtlety worth double-checking: `sendingSinkIx_ = kMaxSinks` after Send only fires `if (sink != nullptr)` — but that's fine since it was only set to `sinkIx` when `sink != nullptr` in the first place. Let's review the manager and MidiPanel diffs:
- CALL Bash: git diff -- projects/synth/runtime/MidiConnectionManager.hpp | head -250
  OUT: diff --git a/projects/synth/runtime/MidiConnectionManager.hpp b/projects/synth/runtime/MidiConnectionManager.hpp
index ddf63ca..9ddae6b 100644
--- a/p
- SAY: This all looks correct. Let's double check for one subtlety in `ResizeToControllerCount`: previously, when `oldCount == newCount`, the code still iterated `0..count` and reinstalled forwarding processors on **every** index (even unchanged ones) — my new code preserves that behavior via the final `for (std::size_t ix = 0; ix < newCount; ++ix) InstallForwardingProcessor(ix);` loop, matching prior behavior exactly. Good. Now let's check the MidiPanel.hpp diff:
- CALL Bash: git diff -- projects/synth/runtime/MidiPanel.hpp
  OUT: diff --git a/projects/synth/runtime/MidiPanel.hpp b/projects/synth/runtime/MidiPanel.hpp
index 9cf0bff..5b46389 100644
--- a/projects/synth/runtime/Mi
- SAY: This all looks good. Now let's check the `MidiReconcile.hpp`/`.cpp` diff for Fix 4:
- CALL Bash: git diff -- projects/synth/include/synth/MidiReconcile.hpp projects/synth/src/MidiReconcile.cpp
  OUT: diff --git a/projects/synth/include/synth/MidiReconcile.hpp b/projects/synth/include/synth/MidiReconcile.hpp
index 9070d35..3cdbca4 100644
--- a/proje
- SAY: Everything looks solid. Now let's run the full test suite once more, plus the 8x sender test, and the apps build, to give a final green confirmation before committing.
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && make -C . build test 2>&1 | grep -E "^\[FAIL\]|warning|error" ; echo "exit: $?"
  OUT: exit: 1
- SAY: No FAIL/warning/error lines (grep exit 1 = no matches, expected). Let's confirm the counts match all binaries and get pass totals:
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && make build test 2>&1 | grep -c "^\[PASS\]"
  OUT: 338
- SAY: 338 passing (up from 325 in the original report — +13, matching 7 new `PlanMidiConnectionResize` cases + 6 new `midi_sender_tests` cases). Let's run the sender test 8x again as final confirmation and rebuild apps once more cleanly:
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && FAIL=0; for i in $(seq 1 8); do ./build/midi_sender_tests > /tmp/sender_run_$i.log 2>&1 || FAIL=1; done; grep -L "FAIL" /tmp/sender_run_*.log | wc -l; echo "any FAIL marker present:"; grep -l "FAIL" /tmp/sender_run_*.log 
  OUT:        8
any FAIL marker present:
none
- SAY: All 8 runs clean, no failures. Now let's rebuild apps target one final time and confirm the test target under `apps/miniapp` also still passes:
- CALL Bash: cd /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth && make -C apps/miniapp test 2>&1 | tail -30
  OUT: c++ -I/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/projects/synth/runtime/../include -I/Users/joyo/Sheaf/.claude/worktrees/silly-meninsky
- SAY: All green. Now let's write the fix report and commit.
- CALL mcp__ccd_session__mark_chapter: {"title": "Report and commit", "summary": "Append fix report to p3-task-2-report.md, then commit"}
  OUT: Chapter marked: "Report and commit". Continue your current work.
- CALL Read: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p3-task-2-report.md
  OUT: 140	## Commit
141	`feat(synth-runtime): per-controller connection manager with plan executor`
142	
143	## Concerns / follow-ups for Plan 3 Task 3 (or 
- SAY: Now let's append the fix report:
- CALL Edit: /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p3-task-2-report.md
  OUT: The file /Users/joyo/Sheaf/.claude/worktrees/silly-meninsky-138d3d/.superpowers/sdd/p3-task-2-report.md has been updated successfully. (file state is 
- SAY: Now let's commit. Let's check git status and diff summary first.
- CALL Bash: git status --short
  OUT:  M projects/synth/Makefile
 M projects/synth/include/synth/MidiController.hpp
 M projects/synth/include/synth/MidiReconcile.hpp
 M projects/synth/runt
- SAY: The report file isn't showing — let me check if `.superpowers` is gitignored:
- CALL Bash: git status --short --ignored=matching -- .superpowers/sdd/p3-task-2-report.md; git check-ignore -v .superpowers/sdd/p3-task-2-report.md
  OUT: !! .superpowers/sdd/p3-task-2-report.md
.superpowers/sdd/.gitignore:1:*	.superpowers/sdd/p3-task-2-report.md
- SAY: That's expected — the report dir is gitignored (session artifacts, not code). Now let's stage and commit the code changes.
- CALL Bash: git add projects/synth/Makefile projects/synth/include/synth/MidiController.hpp projects/synth/include/synth/MidiReconcile.hpp projects/synth/runtime/MidiConnectionManager.hpp projects/synth/runtime/MidiPanel.hpp projects/synth/src/MidiController.cpp projects/synth/src/MidiReconcile.cpp projects/syn
  OUT: M  projects/synth/Makefile
M  projects/synth/include/synth/MidiController.hpp
M  projects/synth/include/synth/MidiReconcile.hpp
M  projects/synth/runt
- CALL Bash: git commit -m "$(cat <<'EOF'
fix(synth): sink clear synchronization, startup reconcile gate, manual-open names

Fixes four Task 2 code review findings for MidiConnectionManager:

1. (Critical) MidiSender::ClearSinkSync synchronizes a sink clear with any
   in-flight Send() on that sink, closing a us
  OUT: [claude/silly-meninsky-138d3d 729666a] fix(synth): sink clear synchronization, startup reconcile gate, manual-open names
 9 files changed, 615 inserti
- CALL Bash: git log -1 --format="%H %s"
  OUT: 729666ae72a28f0b24bc604b87ee19b00457d118 fix(synth): sink clear synchronization, startup reconcile gate, manual-open names
- SAY: All four reviewer findings are fixed, verified, and committed.

**Status:** complete, all four findings fixed and verified.

**Commit:** `729666ae72a28f0b24bc604b87ee19b00457d118` — "fix(synth): sink clear synchronization, startup reconcile gate, manual-open names"

**Test summary:** `make -C projects/synth build test` — 338 passed, 0 failed, zero warnings on a clean rebuild (up from 325 baseline: +7 `PlanMidiConnectionResize` cases, +6 new `midi_sender_tests` cases). New `midi_sender_tests` binary run 8x standalone, zero failures. `make -C projects/synth apps` links cleanly with zero warnings
