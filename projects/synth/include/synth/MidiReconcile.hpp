#pragma once

#include "synth/MidiController.hpp"

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

namespace synth {

enum class MidiEndpointStatus { Unconfigured, Offline, Online };

struct MidiEndpointConnection {
    MidiEndpointStatus status = MidiEndpointStatus::Unconfigured;
    std::string openIdentifier;   // meaningful only when Online
};
struct MidiControllerConnection { MidiEndpointConnection input; MidiEndpointConnection output; };
struct MidiConnectionState { std::vector<MidiControllerConnection> controllers; };

struct MidiDeviceInfoRef {
    std::string identifier;
    std::string name;
    friend bool operator==(const MidiDeviceInfoRef&, const MidiDeviceInfoRef&) = default;
};
struct MidiDeviceList {
    std::vector<MidiDeviceInfoRef> inputs;
    std::vector<MidiDeviceInfoRef> outputs;
    // Exact order-sensitive equality (Task 3 review, Minor: lets
    // MidiConnectionManager::Reconcile() quiet its per-tick INFO log when the
    // enumerated device list is unchanged since the last converged pass --
    // see lastEnumerated_'s doc comment). Present devices are enumerated in
    // JUCE's own AvailableDevices() order, which is stable call-to-call when
    // the actual device set hasn't changed, so this is not a false-negative
    // hazard in practice.
    friend bool operator==(const MidiDeviceList&, const MidiDeviceList&) = default;
};

struct ReconcileAction {
    enum class Type {
        OpenInput, OpenOutput,          // identifier = device to open
        CloseInput, CloseOutput,
        MarkInputOffline, MarkOutputOffline,
        UpdateInputRef, UpdateOutputRef, // identifier+name = new stored ref
        Resync                           // clear output caches + force resend
    };
    Type type;
    std::size_t controllerIx = 0;
    std::string identifier;
    std::string name;
};
struct ReconcilePlan { std::vector<ReconcileAction> actions; };

// Pure, JUCE-free reconciliation planner: decides what should open/close/go
// offline/update its stored ref/resync, given the instrument's configured
// controller slots, the currently present MIDI devices, and the connection
// state the host is maintaining in parallel with `instrument.controllers`.
//
// Precondition: `current.controllers.size() == instrument.controllers.size()`
// (the host maintains parallel per-controller connection state). When sizes
// mismatch, entries missing from `current` are treated as all-Unconfigured;
// this never crashes.
//
// Matching (smi-3): for each slot's ref, try an exact identifier match
// against present devices first; if that misses, fall back to a stored-name
// match, skipping devices already claimed by an earlier slot in this pass (so
// two identically-named present devices can still serve two distinct slots,
// deterministically in slot order). A name-fallback match ALWAYS emits an
// UpdateInputRef/UpdateOutputRef action carrying the matched device's
// identifier+name -- including when the endpoint is already Online on the
// matched device (the connection is fine, but the stored ref is stale and
// must be refreshed to an exact-identifier ref). Each present device is
// assigned to at most one slot per plan -- slots are considered in order, and
// the first matching slot claims the device; a losing slot that was
// previously Online also gets a Close* (then Mark*Offline). An unconfigured
// ref (!IsConfigured()) is inert with respect to OPENING anything: no
// Open*/UpdateRef action is ever produced for it, regardless of device
// presence. It is NOT unconditionally inert, though -- a ref can become
// unconfigured while its endpoint is still Online (e.g. the UI clearing a
// device combo to "(none)"/SetEndpointRef{}), and that orphaned open device
// must be closed: an unconfigured ref whose connection status is Online gets
// a Close* + Mark*Offline, exactly like a configured-but-now-absent ref
// (below); an unconfigured ref whose connection status is already
// Offline/Unconfigured produces no actions (idempotence -- nothing to close,
// nothing to mark). A CONFIGURED ref that matches no present device SHALL
// end Offline regardless of its current
// connection status: an Online endpoint whose openIdentifier is no longer
// present is closed and marked offline; an Unconfigured connection status
// (the startup shape -- a configured ref with no prior open/close history,
// e.g. before the first reconcile pass) is marked offline directly, with no
// Close* (there is nothing open to close). An already-Offline endpoint whose
// device remains absent produces no actions (idempotence). Exactly one
// Resync is emitted per controller per plan, and only when the plan opens
// that controller's OUTPUT endpoint.
ReconcilePlan PlanMidiReconciliation(const MidiInstrumentConfig& instrument,
                                     const MidiDeviceList& present,
                                     const MidiConnectionState& current);

// Abstract endpoint operations a plan executor invokes -- JUCE-free (no
// dependency on synth_juce::MidiInHandler/MidiOutputHandler or the engine);
// the runtime (synth_runtime::MidiConnectionManager) binds these to real
// device handlers and Engine<App> calls. openInput/openOutput return false
// on failure (device not found, open failed); all other ops are void because
// ExecuteReconcilePlan has no fallback behavior for them -- a close/update/
// resync that "fails" silently has nowhere else to go from here.
struct MidiEndpointOps {
    std::function<bool(std::size_t ix, const std::string& identifier)> openInput;
    std::function<bool(std::size_t ix, const std::string& identifier)> openOutput;
    std::function<void(std::size_t ix)> closeInput;
    std::function<void(std::size_t ix)> closeOutput;
    std::function<void(std::size_t ix, const std::string& id, const std::string& name)> updateInputRef;
    std::function<void(std::size_t ix, const std::string& id, const std::string& name)> updateOutputRef;
    std::function<void(std::size_t ix)> resync;
};

// Applies `plan` to `ops` strictly in list order (executors MUST NOT reorder
// or batch actions -- see the planner's own doc comment: it emits Close*
// before the matching Open* for a slot reopening under a different
// identifier, and callers depend on that ordering being preserved through
// execution). Returns a new MidiConnectionState derived from `current` with
// each action's effect applied as it is processed, so the return value
// reflects every open/close/mark/update in the order they were applied --
// not just the plan's net intent.
//
// Per-action semantics:
//   OpenInput/OpenOutput: calls ops.openInput/openOutput(ix, identifier). On
//     success, the endpoint's status becomes Online with openIdentifier set
//     to `identifier`. On failure (returns false), the endpoint's status
//     becomes Offline (NOT Online, and openIdentifier is cleared) and
//     execution continues with the remaining actions -- a failed open is
//     never fatal to the rest of the plan.
//   CloseInput/CloseOutput: calls ops.closeInput/closeOutput(ix). Does not,
//     by itself, change status -- the planner always pairs a Close with a
//     following Open or Mark*Offline action, so status transitions happen
//     there.
//   MarkInputOffline/MarkOutputOffline: sets the endpoint's status to
//     Offline and clears openIdentifier, without calling any op (the
//     preceding Close* action already performed the actual device close).
//   UpdateInputRef/UpdateOutputRef: calls ops.updateInputRef/updateOutputRef
//     with the new identifier+name. Stored-ref rewriting is the runtime's
//     concern (via engine.EditInstrument); this executor does not track
//     stored refs itself, only connection status.
//   Resync: calls ops.resync(ix) exactly once, for that one action -- a plan
//     with N Resync actions for the same controller (which the planner never
//     produces, but this executor does not assume) invokes ops.resync N
//     times, once per action, in order.
//
// A null std::function for any op used by the plan is simply not called
// (target-less std::function is falsy); this lets tests exercise a subset of
// actions without wiring every op.
MidiConnectionState ExecuteReconcilePlan(const ReconcilePlan& plan, const MidiConnectionState& current,
                                         const MidiEndpointOps& ops);

// Pure, JUCE-free bookkeeping decision for MidiConnectionManager's
// controller-count resize (Task 2 review, Minor: extracted so it can be unit
// tested without a JUCE handler vector or a live synth::Engine<App>). Given
// the OLD handler-vector size and the NEW controller count
// (engine.MidiControllerCount()), decides which controller indices must be
// torn down (closed, and -- for outputs -- have their MidiSender sink
// cleared) before the handler vectors are resized, and which indices are
// newly grown (need a fresh handler constructed) after the resize.
//
// Semantics, mirroring MidiConnectionManager::ResizeToControllerCount's
// pre-extraction behavior exactly:
//   - Growth (newCount > oldCount): closingIx is empty; growingIx is
//     [oldCount, newCount).
//   - Shrink (newCount < oldCount): closingIx is [newCount, oldCount)  --
//     every trailing index being dropped, both input and output (a shrink
//     never keeps an input handler for an index whose output handler is
//     dropped, or vice versa: the two vectors are always resized to the same
//     count); growingIx is empty.
//   - Same size (newCount == oldCount): both closingIx and growingIx are
//     empty -- a true no-op, not just "nothing observable happens" but
//     literally zero close/construct work planned.
// closingIx is always sorted ascending (matches the loop order
// ResizeToControllerCount used, index 0 upward), and is the set of indices
// whose OUTPUT sink must be cleared via MidiSender::ClearSinkSync (not
// SetSink(ix, nullptr) -- see that method's doc comment) before the caller
// destroys the handler at that index, since the handler vectors are resized
// (destroying trailing unique_ptrs) immediately after teardown.
struct MidiConnectionResizePlan {
    std::vector<std::size_t> closingIx;
    std::vector<std::size_t> growingIx;
};

MidiConnectionResizePlan PlanMidiConnectionResize(std::size_t oldCount, std::size_t newCount);

// Pure, JUCE-free decision for MidiConnectionManager::OnInstrumentRebuilt()
// (Task 3 review, Important: the `started_` gate that suppresses a reconcile
// pass for a pre-startup rebuild was previously inline logic in a JUCE
// template method and had no dedicated test -- a refactor that dropped or
// inverted the `!started` check would have shipped silently, since nothing
// but a full JUCE runtime build would exercise it). Folds the resize
// decision (PlanMidiConnectionResize, above) together with the reconcile
// gate so OnInstrumentRebuilt() has exactly one call to make.
//
// `started` mirrors MidiConnectionManager::started_: false until
// StartupReconcile() has run its one synchronous startup reconcile pass. A
// rebuild that fires before that point must resize the handler/state vectors --
// the vectors need to be correctly sized regardless of what ran before -- but
// must NOT also run a reconcile pass, or the binding startup order ("engine
// init -> runtime config -> ONE synchronous reconcile -> start poller -> ...")
// would be violated by an extra early reconcile. Once `started` is true, every
// rebuild (runtime config changes, manual ref updates, etc., per sar-8) both
// resizes and reconciles.
//
// This function does not know about reconciling_ (MidiConnectionManager's
// separate EditInstrument-re-entrancy guard) -- that guard is orthogonal
// (it suppresses a reconcile pass that would otherwise nest inside an
// in-flight one) and stays the caller's responsibility, exactly as before.
struct MidiRebuildResponse {
    MidiConnectionResizePlan resizePlan;
    bool reconcile = false;
};

MidiRebuildResponse PlanMidiRebuildResponse(bool started, std::size_t oldCount, std::size_t newCount);

// Pure, JUCE-free decision for MidiConnectionManager::OnTimerTick() (smi-4:
// "WHEN the device list is unchanged from the previous message-thread pass,
// THE message thread SHALL NOT run reconciliation planning or plan
// execution"). Mirrors PlanMidiRebuildResponse's shape: a tiny pinned gate
// function so the poll-tick skip decision is unit-testable headlessly,
// instead of living only as inline logic in a JUCE template method that
// only a full JUCE runtime build would exercise.
//
// Inputs:
//   pollerDirty    -- MidiDevicePoller::ConsumeChange()'s return value for
//                      this tick (false: the poller itself observed no
//                      change since its last cycle -- including degraded
//                      mode's own snapshot-compare -- so there is nothing
//                      to even re-enumerate for).
//   listChanged    -- true when the message thread's own authoritative
//                      re-enumeration (EnumerateNow(), called only when
//                      pollerDirty is true) differs from the previous
//                      message-thread pass's list (MidiConnectionManager's
//                      lastEnumerated_/hasLastEnumerated_).
//   rebuildPending -- true when an instrument-rebuild-triggered reconcile
//                      (patch load, UI edit, i.e. OnInstrumentRebuilt()) is
//                      the reason this pass must not be skipped even though
//                      the enumerated list itself is unchanged. On the
//                      runtime's actual timer ordering (MessageThreadTick()
//                      -- which drains any pending rebuild and runs its own
//                      reconcile pass -- always runs before OnTimerTick() in
//                      the same tick, per Runtime::timerCallback()), a
//                      rebuild reconcile for this tick has always already
//                      completed by the time OnTimerTick() runs; this
//                      parameter exists so that invariant is an explicit,
//                      tested input to the gate rather than an assumption
//                      baked silently into the skip condition, and so a
//                      caller on a different timer ordering (or a guard
//                      flag like reconciling_) can still force a reconcile
//                      through this same pure decision point.
//
// Reconciliation planning/execution SHALL run (reconcile=true) unless the
// poller was not dirty, or the poller was dirty but the re-enumerated list
// is unchanged from the previous pass AND no rebuild-triggered reconcile is
// pending. A no-op tick still needs to re-enumerate (when the poller was
// dirty) so the caller can refresh lastEnumerated_/hasLastEnumerated_ even
// though it will not go on to plan/execute -- that decision (whether to
// call EnumerateNow() at all) is `pollerDirty` itself, which the caller
// already has before calling this function.
struct MidiTickResponse {
    bool reconcile = false;
};

MidiTickResponse PlanMidiTickResponse(bool pollerDirty, bool listChanged, bool rebuildPending);

} // namespace synth
