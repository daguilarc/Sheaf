#include "synth/MidiReconcile.hpp"

#include <unordered_set>

namespace synth {

namespace {

// Finds a present device by exact identifier match.
const MidiDeviceInfoRef* FindByIdentifier(const std::vector<MidiDeviceInfoRef>& devices,
                                          const std::string& identifier) {
    for (const auto& device : devices) {
        if (device.identifier == identifier) {
            return &device;
        }
    }
    return nullptr;
}

// Finds a present device by exact stored-name match (fallback when identifier misses), skipping
// devices already claimed by an earlier slot in this pass. This lets two identical-name devices
// (distinct identifiers) serve two different slots deterministically in slot order, instead of
// both slots' name-fallback racing to the same first name match.
const MidiDeviceInfoRef* FindByName(const std::vector<MidiDeviceInfoRef>& devices, const std::string& name,
                                    const std::unordered_set<std::string>& claimed) {
    for (const auto& device : devices) {
        if (device.name == name && claimed.count(device.identifier) == 0) {
            return &device;
        }
    }
    return nullptr;
}

MidiEndpointConnection ConnectionFor(const MidiConnectionState& current, std::size_t controllerIx, bool isInput) {
    if (controllerIx >= current.controllers.size()) {
        return MidiEndpointConnection{};
    }
    return isInput ? current.controllers[controllerIx].input : current.controllers[controllerIx].output;
}

// Runs one pass (input or output) across all controller slots, matching present devices to
// configured refs with one-device-one-slot semantics (slot order wins contention), and appends
// the resulting actions to `plan`. Returns the set of controller indices for which this pass
// planned an open -- callers use this for output to know which controllers need a Resync.
std::unordered_set<std::size_t> PlanEndpointPass(const MidiInstrumentConfig& instrument,
                                                 const std::vector<MidiDeviceInfoRef>& devices,
                                                 const MidiConnectionState& current, bool isInput,
                                                 ReconcilePlan& plan) {
    using Type = ReconcileAction::Type;
    const Type openType = isInput ? Type::OpenInput : Type::OpenOutput;
    const Type closeType = isInput ? Type::CloseInput : Type::CloseOutput;
    const Type offlineType = isInput ? Type::MarkInputOffline : Type::MarkOutputOffline;
    const Type updateType = isInput ? Type::UpdateInputRef : Type::UpdateOutputRef;

    std::unordered_set<std::string> claimed;
    std::unordered_set<std::size_t> opened;

    for (std::size_t ix = 0; ix < instrument.controllers.size(); ++ix) {
        const MidiEndpointRef& ref = isInput ? instrument.controllers[ix].input : instrument.controllers[ix].output;
        const MidiEndpointConnection connection = ConnectionFor(current, ix, isInput);

        if (!ref.IsConfigured()) {
            // An unconfigured ref is inert with respect to OPENING anything -- no
            // Open*/UpdateRef is ever planned for it, regardless of device presence. But
            // it is not unconditionally inert: a ref can become unconfigured while its
            // endpoint is still Online (e.g. the UI clearing a device combo to "(none)"
            // via SetEndpointRef{}), and that orphaned open device must be closed rather
            // than left running forever. Mirror the "device now absent" handling below --
            // Close* + Mark*Offline when currently Online, nothing when already
            // Offline/Unconfigured (idempotent).
            if (connection.status == MidiEndpointStatus::Online) {
                ReconcileAction close;
                close.type = closeType;
                close.controllerIx = ix;
                close.identifier = connection.openIdentifier;
                plan.actions.push_back(close);

                ReconcileAction offline;
                offline.type = offlineType;
                offline.controllerIx = ix;
                plan.actions.push_back(offline);
            }
            continue;
        }

        const MidiDeviceInfoRef* match = nullptr;
        bool viaNameFallback = false;
        if (!ref.identifier.empty()) {
            match = FindByIdentifier(devices, ref.identifier);
        }
        if (match == nullptr && !ref.name.empty()) {
            match = FindByName(devices, ref.name, claimed);
            viaNameFallback = match != nullptr;
        }

        const bool deviceClaimed = match != nullptr && claimed.count(match->identifier) > 0;
        const bool canClaim = match != nullptr && !deviceClaimed;

        if (canClaim) {
            claimed.insert(match->identifier);

            const bool alreadyOpenHere =
                connection.status == MidiEndpointStatus::Online && connection.openIdentifier == match->identifier;
            if (!alreadyOpenHere) {
                if (connection.status == MidiEndpointStatus::Online) {
                    // Reopening under a different identifier: close the stale one first.
                    ReconcileAction close;
                    close.type = closeType;
                    close.controllerIx = ix;
                    close.identifier = connection.openIdentifier;
                    plan.actions.push_back(close);
                }

                ReconcileAction open;
                open.type = openType;
                open.controllerIx = ix;
                open.identifier = match->identifier;
                plan.actions.push_back(open);
                opened.insert(ix);
            }

            // A name-fallback match always rewrites the stale stored ref to the matched
            // identifier+name -- even when the endpoint is already Online on that matched
            // device (the connection itself is fine, but the stored ref is stale and must be
            // refreshed so future reconciliations exact-match on identifier again).
            if (viaNameFallback) {
                ReconcileAction update;
                update.type = updateType;
                update.controllerIx = ix;
                update.identifier = match->identifier;
                update.name = match->name;
                plan.actions.push_back(update);
            }
            continue;
        }

        // No claimable match (either absent entirely, or lost contention to an earlier slot).
        // The ref IS configured, so this endpoint SHALL end Offline -- including from
        // Unconfigured connection status (the startup shape: empty/default connection state,
        // device absent). Close* is only emitted when something is actually open (Online); the
        // Unconfigured->Offline transition has nothing to close.
        if (connection.status == MidiEndpointStatus::Online) {
            ReconcileAction close;
            close.type = closeType;
            close.controllerIx = ix;
            close.identifier = connection.openIdentifier;
            plan.actions.push_back(close);

            ReconcileAction offline;
            offline.type = offlineType;
            offline.controllerIx = ix;
            plan.actions.push_back(offline);
        } else if (connection.status == MidiEndpointStatus::Unconfigured) {
            ReconcileAction offline;
            offline.type = offlineType;
            offline.controllerIx = ix;
            plan.actions.push_back(offline);
        }
        // Already-Offline with no claim: idempotent, no action.
    }

    return opened;
}

} // namespace

ReconcilePlan PlanMidiReconciliation(const MidiInstrumentConfig& instrument, const MidiDeviceList& present,
                                     const MidiConnectionState& current) {
    ReconcilePlan plan;

    PlanEndpointPass(instrument, present.inputs, current, /*isInput=*/true, plan);
    std::unordered_set<std::size_t> outputOpens =
        PlanEndpointPass(instrument, present.outputs, current, /*isInput=*/false, plan);

    for (std::size_t ix = 0; ix < instrument.controllers.size(); ++ix) {
        if (outputOpens.count(ix) > 0) {
            ReconcileAction resync;
            resync.type = ReconcileAction::Type::Resync;
            resync.controllerIx = ix;
            plan.actions.push_back(resync);
        }
    }

    return plan;
}

namespace {

// Grows `state.controllers` (default-constructed, i.e. all-Unconfigured
// entries) so that index `ix` is valid, mirroring the planner's own
// tolerance for a `current` state missing entries (see
// PlanMidiReconciliation's doc comment: "entries missing from `current` are
// treated as all-Unconfigured; this never crashes"). ExecuteReconcilePlan
// extends this same tolerance to its own working copy of the state.
void EnsureControllerSlot(MidiConnectionState& state, std::size_t ix) {
    if (ix >= state.controllers.size()) {
        state.controllers.resize(ix + 1);
    }
}

} // namespace

MidiConnectionState ExecuteReconcilePlan(const ReconcilePlan& plan, const MidiConnectionState& current,
                                         const MidiEndpointOps& ops) {
    using Type = ReconcileAction::Type;
    MidiConnectionState state = current;

    for (const ReconcileAction& action : plan.actions) {
        EnsureControllerSlot(state, action.controllerIx);
        MidiControllerConnection& controller = state.controllers[action.controllerIx];

        switch (action.type) {
            case Type::OpenInput: {
                const bool opened = ops.openInput && ops.openInput(action.controllerIx, action.identifier);
                if (opened) {
                    controller.input.status = MidiEndpointStatus::Online;
                    controller.input.openIdentifier = action.identifier;
                } else {
                    controller.input.status = MidiEndpointStatus::Offline;
                    controller.input.openIdentifier.clear();
                }
                break;
            }
            case Type::OpenOutput: {
                const bool opened = ops.openOutput && ops.openOutput(action.controllerIx, action.identifier);
                if (opened) {
                    controller.output.status = MidiEndpointStatus::Online;
                    controller.output.openIdentifier = action.identifier;
                } else {
                    controller.output.status = MidiEndpointStatus::Offline;
                    controller.output.openIdentifier.clear();
                }
                break;
            }
            case Type::CloseInput:
                if (ops.closeInput) {
                    ops.closeInput(action.controllerIx);
                }
                break;
            case Type::CloseOutput:
                if (ops.closeOutput) {
                    ops.closeOutput(action.controllerIx);
                }
                break;
            case Type::MarkInputOffline:
                controller.input.status = MidiEndpointStatus::Offline;
                controller.input.openIdentifier.clear();
                break;
            case Type::MarkOutputOffline:
                controller.output.status = MidiEndpointStatus::Offline;
                controller.output.openIdentifier.clear();
                break;
            case Type::UpdateInputRef:
                if (ops.updateInputRef) {
                    ops.updateInputRef(action.controllerIx, action.identifier, action.name);
                }
                break;
            case Type::UpdateOutputRef:
                if (ops.updateOutputRef) {
                    ops.updateOutputRef(action.controllerIx, action.identifier, action.name);
                }
                break;
            case Type::Resync:
                if (ops.resync) {
                    ops.resync(action.controllerIx);
                }
                break;
        }
    }

    return state;
}

MidiConnectionResizePlan PlanMidiConnectionResize(std::size_t oldCount, std::size_t newCount) {
    MidiConnectionResizePlan plan;
    for (std::size_t ix = newCount; ix < oldCount; ++ix) {
        plan.closingIx.push_back(ix);
    }
    for (std::size_t ix = oldCount; ix < newCount; ++ix) {
        plan.growingIx.push_back(ix);
    }
    return plan;
}

MidiRebuildResponse PlanMidiRebuildResponse(bool started, std::size_t oldCount, std::size_t newCount) {
    MidiRebuildResponse response;
    response.resizePlan = PlanMidiConnectionResize(oldCount, newCount);
    response.reconcile = started;
    return response;
}

MidiTickResponse PlanMidiTickResponse(bool pollerDirty, bool listChanged, bool rebuildPending) {
    MidiTickResponse response;
    response.reconcile = pollerDirty && (listChanged || rebuildPending);
    return response;
}

} // namespace synth
