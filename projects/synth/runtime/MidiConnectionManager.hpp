#pragma once

// synth_runtime::MidiConnectionManager — per-controller MIDI device lifecycle
// owner (Plan 3 Task 2). Owns a vector of synth_juce::MidiInHandler/
// MidiOutputHandler parallel to the engine's instrument controller slots,
// plus the MidiConnectionState mirror and the MidiDevicePoller that watches
// for USB device list changes in the background. This is the runtime-side
// binding of the JUCE-free ExecuteReconcilePlan/PlanMidiReconciliation core
// (include/synth/MidiReconcile.hpp) to real JUCE device handlers and
// synth::Engine<App>.
//
// Forwarding-processor swap safety (binding, see p3-globals.md): reopening
// or rebuilding a controller's input device must never leave a MIDI callback
// pointing at a destroyed processor chain. This class reuses the same
// detach -> rebuild -> reattach discipline MidiPanel.hpp established
// (MidiPanel.hpp:240-294, OnMidiProcessorsWillRebuild +
// InstallForwardingProcessor), applied per controller instead of just slot
// 0: engine.SetMidiProcessorsWillRebuildCallback must be wired (by the host,
// e.g. Runtime) to call this class's OnMidiProcessorsWillRebuild() BEFORE
// the engine destroys midiProcessors_, and the rebuilt callback should call
// OnInstrumentRebuilt() afterward. Between those two calls, every input
// handler's forwarding processor is detached (SetProcessor(nullptr)); no
// code in this class dereferences a MidiInProcessor* outside that window.
//
// EditInstrument re-entrancy (binding, see p3-task-2-brief.md): Update*Ref
// actions in a reconcile plan write the matched device's identifier+name
// back into the engine's live instrument via engine.EditInstrument, and
// EditInstrument ALWAYS rebuilds MIDI processors and fires the
// rebuilt-callback synchronously (Engine::EditInstrument's own doc comment).
// If that rebuilt callback forwarded straight back into this manager's
// reconcile path, an UpdateInputRef/UpdateOutputRef action partway through
// ExecuteReconcilePlan would re-enter reconciliation before the current pass
// has finished applying its own actions. This class guards against that
// with reconciling_: OnInstrumentRebuilt() (the method a host wires as the
// rebuilt-callback target) no-ops when reconciling_ is already true, instead
// of running a nested reconcile pass. This is a guard-flag choice, not a
// batch-and-apply-after choice: the alternative (collect ref updates and
// apply them once after ExecuteReconcilePlan returns) would mean
// UpdateInputRef/UpdateOutputRef's ops callback couldn't call
// engine.EditInstrument synchronously either, which would just move the
// same problem into a hand-rolled batching layer instead of removing it. The
// guard is sufficient because OnInstrumentRebuilt()'s only real job here
// (beyond the resize) is to run exactly one reconcile pass per rebuild
// trigger, and the plan currently executing already IS that pass for this
// trigger -- a nested call has nothing new to reconcile.
//
// Ownership handoff from MidiPanel (binding, see p3-globals.md's
// architecture paragraph: "The runtime replaces MidiPanel's single handler
// pair with a per-controller vector..."): this manager is now the sole owner
// of every controller slot's MidiInHandler/MidiOutputHandler, including slot
// 0 -- MidiPanel.hpp no longer owns inHandler_/outHandler_ or registers a
// sink itself (see that file's updated class doc comment). MidiPanel is a
// thin UI shell: its combo boxes/buttons/status label read and write through
// this manager's slot-scoped ManualOpenInput/ManualOpenOutput/
// ManualCloseInput/ManualCloseOutput/IsInputOpen/IsOutputOpen/
// InputDeviceName/OutputDeviceName/InputLastError/OutputLastError accessors
// instead of owning handlers directly (currently only ever called for slot
// 0), so there is exactly one owner per physical device and no sink/open
// contention. A later plan is expected to replace MidiPanel with a genuinely
// per-controller UI (multiple slot rows instead of one); until then,
// MidiPanel keeps talking to this manager about slot 0 only.
#include "synth/AsyncLogger.hpp"
#include "synth/Engine.hpp"
#include "synth/MidiController.hpp"
#include "synth/MidiDevicePoller.hpp"
#include "synth/MidiReconcile.hpp"
#include "synth/ThreadId.hpp"

#include "MidiHandlers.hpp"

#include <juce_audio_devices/juce_audio_devices.h>

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace synth_runtime {

namespace detail {

// See MidiPanel.hpp's detail::EngineForwardingMidiInProcessor for the full
// rationale (mutex-guarded target swap, MIDI-thread tagging). Duplicated
// here (rather than shared) because MidiPanel.hpp's copy is scoped to a
// single fixed target captured at construction; this manager needs the
// identical shape per controller slot, and the two headers otherwise have no
// dependency on each other -- Plan 4 is expected to delete MidiPanel's
// single-slot copy once the panel itself moves onto this manager (see the
// class doc comment on MidiPanel.hpp).
class EngineForwardingMidiInProcessor final : public synth::MidiInProcessor {
public:
    explicit EngineForwardingMidiInProcessor(synth::MidiInProcessor* target) : target_(target) {}

    void Process(const synth::BasicMidi& midi) override {
        synth::ScopedThreadId tag(synth::ThreadId::MidiInput);
        if (target_ != nullptr) {
            target_->Process(midi);
        }
    }

private:
    synth::MidiInProcessor* target_ = nullptr;
};

inline synth::MidiDeviceList EnumerateDevices() {
    synth::MidiDeviceList list;
    for (const auto& device : synth_juce::MidiInHandler::AvailableDevices()) {
        list.inputs.push_back({device.identifier.toStdString(), device.name.toStdString()});
    }
    for (const auto& device : synth_juce::MidiOutputHandler::AvailableDevices()) {
        list.outputs.push_back({device.identifier.toStdString(), device.name.toStdString()});
    }
    return list;
}

}  // namespace detail

template <synth::SynthApplication App>
class MidiConnectionManager {
public:
    explicit MidiConnectionManager(synth::Engine<App>& engine) : engine_(engine) {}

    ~MidiConnectionManager() {
        // Shutdown ordering (binding, per p3-globals.md): stop/join the
        // poller before closing devices, so no in-flight poll cycle races
        // handler teardown.
        poller_.Stop();
        for (auto& handler : inputHandlers_) {
            if (handler) {
                handler->SetProcessor(nullptr);
                handler->Close();
            }
        }
        for (std::size_t ix = 0; ix < outputHandlers_.size(); ++ix) {
            if (outputHandlers_[ix]) {
                if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
                    sender->SetSink(ix, nullptr);
                }
                outputHandlers_[ix]->Close();
            }
        }
    }

    MidiConnectionManager(const MidiConnectionManager&) = delete;
    MidiConnectionManager& operator=(const MidiConnectionManager&) = delete;

    // Startup order (sar-5, binding): call once after processors have been
    // built (post startup-patch rebuild), BEFORE starting the poller. Resizes
    // handler vectors to the current controller count (state_ starts out
    // default-constructed, i.e. every entry status-unconfigured -- the
    // "empty MidiConnectionState{}" the brief describes as `current`), then
    // runs one synchronous reconcile pass against the actually-enumerated
    // device list. Because `current` (state_) starts all-Unconfigured, the
    // planner still opens every configured ref (PlanMidiReconciliation's
    // matching pass does not require a prior Online/Offline connection
    // record -- only the instrument's configured refs and present devices
    // matter for whether an Open* action is planned); an absent device
    // simply goes offline, never a startup failure. Starts the poller
    // afterward.
    void StartupReconcile() {
        ResizeToControllerCount();
        Reconcile(detail::EnumerateDevices());
        poller_.Start([] { return detail::EnumerateDevices(); });
    }

    // Wired to the runtime's existing message-thread timer tick. Consumes
    // the poller's dirty flag (if any); on a change, re-enumerates
    // authoritatively on the message thread (never trusts the poller's own
    // snapshot for the actual reconcile -- see MidiDevicePoller's class doc
    // comment: the poller exists purely to wake us, not to be the source of
    // truth) and runs one reconcile pass.
    void OnTimerTick() {
        synth::MidiDeviceList latest;
        if (poller_.ConsumeChange(latest)) {
            Reconcile(detail::EnumerateDevices());
        }
    }

    // Wired to engine.SetMidiProcessorsWillRebuildCallback (forwarded by the
    // host, e.g. Runtime): detaches every input handler's forwarding
    // processor before the engine destroys midiProcessors_. See the class
    // doc comment's forwarding-swap-safety paragraph.
    void OnMidiProcessorsWillRebuild() {
        for (auto& handler : inputHandlers_) {
            if (handler) {
                handler->SetProcessor(nullptr);
            }
        }
    }

    // Wired to engine.SetMidiProcessorsRebuiltCallback (forwarded by the
    // host): resizes handler/state vectors to the (possibly changed)
    // controller count, reinstalls forwarding processors against the fresh
    // chain, and runs one reconcile pass (sar-8: this is the same executor
    // path OnTimerTick uses). No-ops (beyond the resize) when a reconcile is
    // already in flight -- see the class doc comment's EditInstrument
    // re-entrancy paragraph.
    void OnInstrumentRebuilt() {
        ResizeToControllerCount();
        if (reconciling_) {
            return;
        }
        Reconcile(detail::EnumerateDevices());
    }

    const synth::MidiConnectionState& State() const { return state_; }

    synth::MidiDeviceList EnumerateNow() const { return detail::EnumerateDevices(); }

    // Manual UI-driven open/close for a single controller slot, used by
    // MidiPanel's toggle buttons (currently slot 0 only -- see the class doc
    // comment). Unlike the plan executor's Open*/Close* ops (invoked only
    // from within Reconcile(), always paired with a status transition the
    // plan already decided on), these are host-initiated: a manual open also
    // records the opened identifier into the engine's live instrument via
    // EditInstrument (mirroring MidiPanel's old SetSlot0Endpoints/
    // SyncEndpointStateFromSelection contract) and updates state_ directly,
    // the same way ExecuteReconcilePlan would for an OpenInput/OpenOutput
    // action -- so the next poll/rebuild reconcile sees a consistent,
    // already-Online state and does not redundantly reopen what the user
    // just opened by hand. Returns false (no state change) when ix is out of
    // range or the open itself fails; the caller (MidiPanel) is responsible
    // for surfacing failure via its own status label, the same way it always
    // has via the handler's LastError().
    //
    // Guarded by reconciling_ around the EditInstrument call (same flag
    // Reconcile() uses, see the class doc comment's re-entrancy paragraph):
    // EditInstrument's synchronous rebuilt callback would otherwise run a
    // whole redundant OnInstrumentRebuilt()-driven reconcile pass on top of
    // the state this method just set directly -- harmless (the pass would
    // see everything already consistent and plan no actions) but wasted
    // work, and it would call InstallForwardingProcessor(ix) a second time.
    // The guard is set/cleared here rather than left to Reconcile() because
    // this path never calls Reconcile() itself.
    bool ManualOpenInput(std::size_t ix, const std::string& identifier) {
        if (ix >= inputHandlers_.size() || identifier.empty()) {
            return false;
        }
        const bool opened = OpenInput(ix, identifier);
        EnsureStateSlot(ix);
        if (opened) {
            state_.controllers[ix].input.status = synth::MidiEndpointStatus::Online;
            state_.controllers[ix].input.openIdentifier = identifier;
            reconciling_ = true;
            UpdateRef(ix, identifier, /*name=*/std::string(), /*isInput=*/true);
            reconciling_ = false;
        }
        return opened;
    }

    bool ManualOpenOutput(std::size_t ix, const std::string& identifier) {
        if (ix >= outputHandlers_.size() || identifier.empty()) {
            return false;
        }
        const bool opened = OpenOutput(ix, identifier);
        EnsureStateSlot(ix);
        if (opened) {
            state_.controllers[ix].output.status = synth::MidiEndpointStatus::Online;
            state_.controllers[ix].output.openIdentifier = identifier;
            reconciling_ = true;
            UpdateRef(ix, identifier, /*name=*/std::string(), /*isInput=*/false);
            reconciling_ = false;
            engine_.ResetMidiOutputProcessors(ix);
        }
        return opened;
    }

    void ManualCloseInput(std::size_t ix) {
        CloseInput(ix);
        EnsureStateSlot(ix);
        state_.controllers[ix].input.status = synth::MidiEndpointStatus::Offline;
        state_.controllers[ix].input.openIdentifier.clear();
    }

    void ManualCloseOutput(std::size_t ix) {
        CloseOutput(ix);
        EnsureStateSlot(ix);
        state_.controllers[ix].output.status = synth::MidiEndpointStatus::Offline;
        state_.controllers[ix].output.openIdentifier.clear();
    }

    bool IsInputOpen(std::size_t ix) const {
        return ix < inputHandlers_.size() && inputHandlers_[ix] && inputHandlers_[ix]->IsOpen();
    }
    bool IsOutputOpen(std::size_t ix) const {
        return ix < outputHandlers_.size() && outputHandlers_[ix] && outputHandlers_[ix]->IsOpen();
    }

    juce::String InputDeviceName(std::size_t ix) const {
        return ix < inputHandlers_.size() && inputHandlers_[ix] ? inputHandlers_[ix]->DeviceName() : juce::String();
    }
    juce::String OutputDeviceName(std::size_t ix) const {
        return ix < outputHandlers_.size() && outputHandlers_[ix] ? outputHandlers_[ix]->DeviceName() : juce::String();
    }
    juce::String InputLastError(std::size_t ix) const {
        return ix < inputHandlers_.size() && inputHandlers_[ix] ? inputHandlers_[ix]->LastError() : juce::String();
    }
    juce::String OutputLastError(std::size_t ix) const {
        return ix < outputHandlers_.size() && outputHandlers_[ix] ? outputHandlers_[ix]->LastError() : juce::String();
    }

private:
    void EnsureStateSlot(std::size_t ix) {
        if (ix >= state_.controllers.size()) {
            state_.controllers.resize(ix + 1);
        }
    }

    // Grows/shrinks inputHandlers_/outputHandlers_/state_.controllers to
    // engine_.MidiControllerCount(), preserving existing entries by index
    // (a shrink closes and drops the trailing handlers/sinks; a growth
    // default-constructs new ones, all-Unconfigured in state_). Reinstalls
    // every surviving input handler's forwarding processor against the
    // (possibly rebuilt) MidiInputProcessor(ix) -- safe to call outside the
    // will-rebuild/rebuilt window too (e.g. from StartupReconcile(), where
    // there is no "prior" chain to race).
    void ResizeToControllerCount() {
        const std::size_t count = engine_.MidiControllerCount();

        for (std::size_t ix = count; ix < inputHandlers_.size(); ++ix) {
            if (inputHandlers_[ix]) {
                inputHandlers_[ix]->SetProcessor(nullptr);
                inputHandlers_[ix]->Close();
            }
        }
        for (std::size_t ix = count; ix < outputHandlers_.size(); ++ix) {
            if (outputHandlers_[ix]) {
                if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
                    sender->SetSink(ix, nullptr);
                }
                outputHandlers_[ix]->Close();
            }
        }

        inputHandlers_.resize(count);
        outputHandlers_.resize(count);
        state_.controllers.resize(count);

        for (std::size_t ix = 0; ix < count; ++ix) {
            if (!inputHandlers_[ix]) {
                inputHandlers_[ix] = std::make_unique<synth_juce::MidiInHandler>();
            }
            if (!outputHandlers_[ix]) {
                outputHandlers_[ix] = std::make_unique<synth_juce::MidiOutputHandler>();
            }
            InstallForwardingProcessor(ix);
        }

        INFO("MidiConnectionManager resized to %zu controller(s)", count);
    }

    void InstallForwardingProcessor(std::size_t ix) {
        inputHandlers_[ix]->SetProcessor(
            std::make_unique<detail::EngineForwardingMidiInProcessor>(engine_.MidiInputProcessor(ix)));
    }

    static juce::String ToJuceString(const std::string& text) { return juce::String(text.c_str()); }

    // Builds the MidiEndpointOps binding for this manager's handlers/engine,
    // runs PlanMidiReconciliation + ExecuteReconcilePlan against `present`,
    // stores the result into state_, and logs a summary. reconciling_ guards
    // the whole call (see the class doc comment's re-entrancy paragraph):
    // updateInputRef/updateOutputRef call engine_.EditInstrument, which
    // synchronously fires the rebuilt callback (OnInstrumentRebuilt) --
    // reconciling_ being true there short-circuits that nested call before
    // it can start a second reconcile pass while this one is still applying
    // actions.
    void Reconcile(const synth::MidiDeviceList& present) {
        reconciling_ = true;
        const synth::MidiInstrumentConfig instrument = engine_.InstrumentSnapshot();
        const synth::ReconcilePlan plan = synth::PlanMidiReconciliation(instrument, present, state_);

        synth::MidiEndpointOps ops;
        ops.openInput = [this](std::size_t ix, const std::string& identifier) { return OpenInput(ix, identifier); };
        ops.openOutput = [this](std::size_t ix, const std::string& identifier) {
            return OpenOutput(ix, identifier);
        };
        ops.closeInput = [this](std::size_t ix) { CloseInput(ix); };
        ops.closeOutput = [this](std::size_t ix) { CloseOutput(ix); };
        ops.updateInputRef = [this](std::size_t ix, const std::string& id, const std::string& name) {
            UpdateRef(ix, id, name, /*isInput=*/true);
        };
        ops.updateOutputRef = [this](std::size_t ix, const std::string& id, const std::string& name) {
            UpdateRef(ix, id, name, /*isInput=*/false);
        };
        ops.resync = [this](std::size_t ix) { Resync(ix); };

        std::size_t opens = 0;
        std::size_t closes = 0;
        std::size_t offline = 0;
        std::size_t resyncs = 0;
        for (const auto& action : plan.actions) {
            switch (action.type) {
                case synth::ReconcileAction::Type::OpenInput:
                case synth::ReconcileAction::Type::OpenOutput:
                    ++opens;
                    break;
                case synth::ReconcileAction::Type::CloseInput:
                case synth::ReconcileAction::Type::CloseOutput:
                    ++closes;
                    break;
                case synth::ReconcileAction::Type::MarkInputOffline:
                case synth::ReconcileAction::Type::MarkOutputOffline:
                    ++offline;
                    break;
                case synth::ReconcileAction::Type::Resync:
                    ++resyncs;
                    break;
                default:
                    break;
            }
        }

        state_ = synth::ExecuteReconcilePlan(plan, state_, ops);
        reconciling_ = false;

        INFO("MIDI reconcile: plan=%zu opens=%zu closes=%zu offline=%zu resyncs=%zu", plan.actions.size(), opens,
             closes, offline, resyncs);
    }

    bool OpenInput(std::size_t ix, const std::string& identifier) {
        if (ix >= inputHandlers_.size() || !inputHandlers_[ix]) {
            return false;
        }
        return inputHandlers_[ix]->Open(ToJuceString(identifier));
    }

    bool OpenOutput(std::size_t ix, const std::string& identifier) {
        if (ix >= outputHandlers_.size() || !outputHandlers_[ix]) {
            return false;
        }
        const bool opened = outputHandlers_[ix]->Open(ToJuceString(identifier));
        if (opened) {
            if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
                sender->SetSink(ix, outputHandlers_[ix].get());
            }
        }
        return opened;
    }

    void CloseInput(std::size_t ix) {
        if (ix < inputHandlers_.size() && inputHandlers_[ix]) {
            inputHandlers_[ix]->Close();
        }
    }

    void CloseOutput(std::size_t ix) {
        if (ix < outputHandlers_.size() && outputHandlers_[ix]) {
            if (synth::MidiSender* sender = engine_.Context().midiSender; sender != nullptr) {
                sender->SetSink(ix, nullptr);
            }
            outputHandlers_[ix]->Close();
        }
    }

    // Writes the matched device's identifier+name back into the engine's
    // live instrument via EditInstrument -- this marks the patch dirty
    // exactly like a UI edit (per p3-globals.md's message-thread-executor
    // paragraph). EditInstrument rebuilds MIDI processors and fires the
    // rebuilt callback synchronously; OnInstrumentRebuilt()'s reconciling_
    // guard (see the class doc comment) prevents that from recursing back
    // into a nested Reconcile() call.
    void UpdateRef(std::size_t ix, const std::string& id, const std::string& name, bool isInput) {
        engine_.EditInstrument([&](synth::MidiInstrumentConfig& instrument) {
            if (ix >= instrument.controllers.size()) {
                return;
            }
            synth::MidiEndpointRef ref;
            ref.identifier = id;
            ref.name = name;
            if (isInput) {
                instrument.controllers[ix].input = ref;
            } else {
                instrument.controllers[ix].output = ref;
            }
        });
        // EditInstrument's rebuild replaced midiProcessors_ (and thus
        // rebuilt every forwarding target); reinstall this slot's forwarding
        // processor against the fresh chain the same way OnInstrumentRebuilt
        // does for every slot, since that path's own reconcile is
        // suppressed while reconciling_ is true (it never gets to do this
        // itself for the current pass).
        if (ix < inputHandlers_.size()) {
            InstallForwardingProcessor(ix);
        }
    }

    // resync = detach forwarding -> engine.ResetMidiOutputProcessors(ix) ->
    // reinstall forwarding, per the class doc comment / brief. Detaching the
    // input forwarding processor around a call that only touches OUTPUT
    // processors is deliberate defensive symmetry with
    // OnMidiProcessorsWillRebuild/OnInstrumentRebuilt's discipline -- it
    // costs nothing (ResetMidiOutputProcessors never replaces the input
    // chain) and keeps every codepath that could plausibly touch
    // midiProcessors_ bracketed the same way.
    void Resync(std::size_t ix) {
        if (ix < inputHandlers_.size() && inputHandlers_[ix]) {
            inputHandlers_[ix]->SetProcessor(nullptr);
        }
        engine_.ResetMidiOutputProcessors(ix);
        if (ix < inputHandlers_.size()) {
            InstallForwardingProcessor(ix);
        }
    }

    synth::Engine<App>& engine_;

    std::vector<std::unique_ptr<synth_juce::MidiInHandler>> inputHandlers_;
    std::vector<std::unique_ptr<synth_juce::MidiOutputHandler>> outputHandlers_;
    synth::MidiConnectionState state_;
    synth::MidiDevicePoller poller_;

    // Guards against OnInstrumentRebuilt() starting a nested reconcile pass
    // when EditInstrument (called from within Reconcile()'s own
    // updateInputRef/updateOutputRef ops) fires the rebuilt callback
    // synchronously. See the class doc comment's re-entrancy paragraph.
    bool reconciling_ = false;
};

}  // namespace synth_runtime
