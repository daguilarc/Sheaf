#pragma once

#include "synth/MidiController.hpp"

#include <cstddef>
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

struct MidiDeviceInfoRef { std::string identifier; std::string name; };
struct MidiDeviceList { std::vector<MidiDeviceInfoRef> inputs; std::vector<MidiDeviceInfoRef> outputs; };

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
// ref (!IsConfigured()) is inert: no open/close/offline/update action is ever
// produced for it, and its status stays Unconfigured. An Online endpoint
// whose openIdentifier is no longer present is closed and marked offline. An
// already-Offline endpoint whose device remains absent produces no actions.
// Exactly one Resync is emitted per controller per plan, and only when the
// plan opens that controller's OUTPUT endpoint.
ReconcilePlan PlanMidiReconciliation(const MidiInstrumentConfig& instrument,
                                     const MidiDeviceList& present,
                                     const MidiConnectionState& current);

} // namespace synth
