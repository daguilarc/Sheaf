#include "synth/MidiReconcile.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

using synth::MidiConnectionState;
using synth::MidiControllerConnection;
using synth::MidiControllerSlot;
using synth::MidiDeviceInfoRef;
using synth::MidiDeviceList;
using synth::MidiEndpointConnection;
using synth::MidiEndpointRef;
using synth::MidiEndpointStatus;
using synth::MidiInstrumentConfig;
using synth::PlanMidiReconciliation;
using synth::ReconcileAction;
using synth::ReconcilePlan;

MidiEndpointRef Ref(std::string identifier, std::string name) {
    MidiEndpointRef ref;
    ref.identifier = std::move(identifier);
    ref.name = std::move(name);
    return ref;
}

MidiControllerSlot Slot(std::string name, MidiEndpointRef input, MidiEndpointRef output) {
    MidiControllerSlot slot;
    slot.name = std::move(name);
    slot.input = std::move(input);
    slot.output = std::move(output);
    return slot;
}

MidiEndpointConnection Conn(MidiEndpointStatus status, std::string openIdentifier = {}) {
    MidiEndpointConnection conn;
    conn.status = status;
    conn.openIdentifier = std::move(openIdentifier);
    return conn;
}

std::size_t CountActions(const ReconcilePlan& plan, ReconcileAction::Type type) {
    std::size_t count = 0;
    for (const auto& action : plan.actions) {
        if (action.type == type) {
            ++count;
        }
    }
    return count;
}

const ReconcileAction* FindAction(const ReconcilePlan& plan, ReconcileAction::Type type) {
    for (const auto& action : plan.actions) {
        if (action.type == type) {
            return &action;
        }
    }
    return nullptr;
}

} // namespace

// identifier match, closed input -> OpenInput (+ no resync: input-only).
TEST_CASE(identifier_match_closed_input_opens_input_only) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("dev-1", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 1);
    REQUIRE_TRUE(plan.actions[0].type == ReconcileAction::Type::OpenInput);
    REQUIRE_TRUE(plan.actions[0].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[0].identifier == "dev-1");
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::Resync) == 0);
}

// identifier match, closed output -> OpenOutput + Resync for that controller.
TEST_CASE(identifier_match_closed_output_opens_output_and_resyncs) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", MidiEndpointRef{}, Ref("dev-2", "Twister")));

    MidiDeviceList present;
    present.outputs.push_back({"dev-2", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Offline)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 2);
    const auto* open = FindAction(plan, ReconcileAction::Type::OpenOutput);
    REQUIRE_TRUE(open != nullptr);
    REQUIRE_TRUE(open->controllerIx == 0);
    REQUIRE_TRUE(open->identifier == "dev-2");
    const auto* resync = FindAction(plan, ReconcileAction::Type::Resync);
    REQUIRE_TRUE(resync != nullptr);
    REQUIRE_TRUE(resync->controllerIx == 0);
}

// name-fallback (stored id absent, name present under new id) -> Open* + Update*Ref with matched id+name.
TEST_CASE(name_fallback_match_opens_and_updates_ref) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("old-id", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"new-id", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 2);
    const auto* open = FindAction(plan, ReconcileAction::Type::OpenInput);
    REQUIRE_TRUE(open != nullptr);
    REQUIRE_TRUE(open->identifier == "new-id");
    const auto* update = FindAction(plan, ReconcileAction::Type::UpdateInputRef);
    REQUIRE_TRUE(update != nullptr);
    REQUIRE_TRUE(update->controllerIx == 0);
    REQUIRE_TRUE(update->identifier == "new-id");
    REQUIRE_TRUE(update->name == "Twister");
}

// contention: two slots whose refs match one present device -> first slot in order gets Open*,
// second gets MarkInputOffline/MarkOutputOffline (when it was Online, also Close*), never two
// opens of one identifier in a plan.
TEST_CASE(contention_first_slot_wins_second_slot_marked_offline) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("First", Ref("dev-1", "Twister"), MidiEndpointRef{}));
    instrument.controllers.push_back(Slot("Second", Ref("dev-1", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenInput) == 1);
    const auto* open = FindAction(plan, ReconcileAction::Type::OpenInput);
    REQUIRE_TRUE(open->controllerIx == 0);
    REQUIRE_TRUE(open->identifier == "dev-1");

    bool secondClosed = false;
    bool secondMarkedOffline = false;
    for (const auto& action : plan.actions) {
        if (action.controllerIx == 1 && action.type == ReconcileAction::Type::CloseInput) {
            secondClosed = true;
        }
        if (action.controllerIx == 1 && action.type == ReconcileAction::Type::MarkInputOffline) {
            secondMarkedOffline = true;
        }
    }
    REQUIRE_TRUE(secondClosed);
    REQUIRE_TRUE(secondMarkedOffline);
}

// vanished: Online endpoint whose open identifier is absent -> Close* + Mark*Offline.
TEST_CASE(vanished_online_endpoint_closes_and_marks_offline) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("dev-1", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present; // nothing present

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 2);
    const auto* close = FindAction(plan, ReconcileAction::Type::CloseInput);
    REQUIRE_TRUE(close != nullptr);
    REQUIRE_TRUE(close->controllerIx == 0);
    REQUIRE_TRUE(close->identifier == "dev-1");
    const auto* offline = FindAction(plan, ReconcileAction::Type::MarkInputOffline);
    REQUIRE_TRUE(offline != nullptr);
    REQUIRE_TRUE(offline->controllerIx == 0);
}

// unconfigured ref -> zero actions for that endpoint, even when devices are present.
TEST_CASE(unconfigured_ref_produces_no_actions_even_with_devices_present) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", MidiEndpointRef{}, MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});
    present.outputs.push_back({"dev-2", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.empty());
}

// Finding 3 (Task 4 review, Important): a ref that was just cleared to
// unconfigured (the UI's "(none)" selection, or SetEndpointRef{} generally)
// while the endpoint is currently Online must still be closed -- an
// unconfigured ref is only "inert" in the sense of never being *opened*; it
// must not leave a stale device handle open forever. This is the truth
// table the brief calls out: unconfigured-ref x {Online, Offline,
// Unconfigured} connection status.
TEST_CASE(unconfigured_ref_input_online_closes_and_marks_offline) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", MidiEndpointRef{}, MidiEndpointRef{}));

    MidiDeviceList present;  // irrelevant to this case; ref is unconfigured either way
    present.inputs.push_back({"dev-1", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 2);
    const auto* close = FindAction(plan, ReconcileAction::Type::CloseInput);
    REQUIRE_TRUE(close != nullptr);
    REQUIRE_TRUE(close->controllerIx == 0);
    REQUIRE_TRUE(close->identifier == "dev-1");
    const auto* offline = FindAction(plan, ReconcileAction::Type::MarkInputOffline);
    REQUIRE_TRUE(offline != nullptr);
    REQUIRE_TRUE(offline->controllerIx == 0);
}

TEST_CASE(unconfigured_ref_output_online_closes_and_marks_offline) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", MidiEndpointRef{}, MidiEndpointRef{}));

    MidiDeviceList present;
    present.outputs.push_back({"dev-2", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Online, "dev-2")});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 2);
    const auto* close = FindAction(plan, ReconcileAction::Type::CloseOutput);
    REQUIRE_TRUE(close != nullptr);
    REQUIRE_TRUE(close->controllerIx == 0);
    REQUIRE_TRUE(close->identifier == "dev-2");
    const auto* offline = FindAction(plan, ReconcileAction::Type::MarkOutputOffline);
    REQUIRE_TRUE(offline != nullptr);
    REQUIRE_TRUE(offline->controllerIx == 0);
    // No Resync -- Resync only follows an OUTPUT *open*, never a close.
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::Resync) == 0);
}

// unconfigured ref, already-Offline connection -> stays inert (idempotent),
// same as before this finding -- an unconfigured ref never triggers a
// Mark*Offline transition it doesn't need.
TEST_CASE(unconfigured_ref_offline_connection_stays_inert) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", MidiEndpointRef{}, MidiEndpointRef{}));

    MidiDeviceList present;

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Offline)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.empty());
}

// input-only slot (output ref unconfigured): full input lifecycle, never an output action,
// never a resync from input reopen.
TEST_CASE(input_only_slot_never_produces_output_action_or_resync) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("dev-1", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    for (const auto& action : plan.actions) {
        REQUIRE_TRUE(action.type != ReconcileAction::Type::OpenOutput);
        REQUIRE_TRUE(action.type != ReconcileAction::Type::CloseOutput);
        REQUIRE_TRUE(action.type != ReconcileAction::Type::MarkOutputOffline);
        REQUIRE_TRUE(action.type != ReconcileAction::Type::UpdateOutputRef);
        REQUIRE_TRUE(action.type != ReconcileAction::Type::Resync);
    }
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenInput) == 1);
}

// already-offline endpoint with device still absent -> no actions (idempotence).
TEST_CASE(already_offline_endpoint_with_device_absent_is_idempotent) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("dev-1", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present; // nothing present

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.empty());
}

// converged: everything Online-and-present / Offline-and-absent / Unconfigured -> empty plan.
TEST_CASE(converged_state_produces_empty_plan) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Online", Ref("dev-1", "Twister"), Ref("dev-2", "Twister")));
    instrument.controllers.push_back(Slot("Offline", Ref("dev-3", "Gone"), MidiEndpointRef{}));
    instrument.controllers.push_back(Slot("Unconfigured", MidiEndpointRef{}, MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});
    present.outputs.push_back({"dev-2", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Online, "dev-2")});
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});
    current.controllers.push_back({Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.empty());
}

// determinism: same inputs twice -> identical action sequences.
TEST_CASE(determinism_same_inputs_produce_identical_plans) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("First", Ref("dev-1", "Twister"), Ref("dev-2", "Twister")));
    instrument.controllers.push_back(Slot("Second", Ref("dev-1", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});
    present.outputs.push_back({"dev-2", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Offline)});
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan first = PlanMidiReconciliation(instrument, present, current);
    ReconcilePlan second = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(first.actions.size() == second.actions.size());
    for (std::size_t i = 0; i < first.actions.size(); ++i) {
        REQUIRE_TRUE(first.actions[i].type == second.actions[i].type);
        REQUIRE_TRUE(first.actions[i].controllerIx == second.actions[i].controllerIx);
        REQUIRE_TRUE(first.actions[i].identifier == second.actions[i].identifier);
        REQUIRE_TRUE(first.actions[i].name == second.actions[i].name);
    }
}

// both endpoints of one controller reopening -> exactly ONE Resync (dedupe per controller).
TEST_CASE(both_endpoints_reopening_produces_exactly_one_resync) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("dev-1", "Twister"), Ref("dev-2", "Twister")));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});
    present.outputs.push_back({"dev-2", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Offline)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenInput) == 1);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenOutput) == 1);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::Resync) == 1);
}

// state-size mismatch (empty current) -> missing entries treated as all-Unconfigured connection
// state, no crash. A missing connection entry does NOT mean the endpoint's *ref* is unconfigured
// -- the slot's ref is still configured and matches a present device, so the planner still plans
// an open (Unconfigured connection status is just "not currently open", same as a fresh Offline
// state would allow). This exercises the precondition note verbatim: the planner must not crash
// on the size mismatch, and must behave exactly as if the missing controllers' connections were
// Unconfigured/Unconfigured.
TEST_CASE(state_size_mismatch_treated_as_unconfigured_no_crash) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("dev-1", "Twister"), Ref("dev-2", "Twister")));

    MidiDeviceList present;
    present.inputs.push_back({"dev-1", "Twister"});
    present.outputs.push_back({"dev-2", "Twister"});

    MidiConnectionState current; // empty -- size mismatch against instrument.controllers

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    MidiConnectionState explicitUnconfigured;
    explicitUnconfigured.controllers.push_back(
        {Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Unconfigured)});
    ReconcilePlan expected = PlanMidiReconciliation(instrument, present, explicitUnconfigured);

    REQUIRE_TRUE(plan.actions.size() == expected.actions.size());
    for (std::size_t i = 0; i < plan.actions.size(); ++i) {
        REQUIRE_TRUE(plan.actions[i].type == expected.actions[i].type);
        REQUIRE_TRUE(plan.actions[i].controllerIx == expected.actions[i].controllerIx);
        REQUIRE_TRUE(plan.actions[i].identifier == expected.actions[i].identifier);
        REQUIRE_TRUE(plan.actions[i].name == expected.actions[i].name);
    }
    // Sanity: this is not vacuously empty -- the ref is configured and the device is
    // present, so treating the missing connection as Unconfigured status still yields
    // an open (Unconfigured connection status, unlike an unconfigured *ref*, is not inert).
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenInput) == 1);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenOutput) == 1);
}

// name-fallback match that is ALREADY Online on the matched device -> UpdateInputRef only,
// rewriting the stale stored ref to the matched identifier+name. No Open/Close: the endpoint is
// already open on the right device, just the stored ref is stale.
TEST_CASE(name_fallback_match_already_online_on_matched_device_only_updates_ref) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", Ref("old-id", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"new-id", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "new-id"), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 1);
    REQUIRE_TRUE(plan.actions[0].type == ReconcileAction::Type::UpdateInputRef);
    REQUIRE_TRUE(plan.actions[0].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[0].identifier == "new-id");
    REQUIRE_TRUE(plan.actions[0].name == "Twister");
}

// two identical-name devices under distinct identifiers, two slots both relying on name-fallback
// -> name-fallback scans for the first UNCLAIMED device with the matching name, so both slots
// resolve deterministically in list order (slot 0 claims the first device, slot 1 claims the
// second), rather than slot 1 failing because slot 0 already claimed the first name match.
TEST_CASE(name_fallback_skips_claimed_devices_for_duplicate_names) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("First", Ref("missing-1", "Twister"), MidiEndpointRef{}));
    instrument.controllers.push_back(Slot("Second", Ref("missing-2", "Twister"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-a", "Twister"});
    present.inputs.push_back({"dev-b", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenInput) == 2);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::UpdateInputRef) == 2);

    std::string slot0Identifier;
    std::string slot1Identifier;
    for (const auto& action : plan.actions) {
        if (action.type == ReconcileAction::Type::OpenInput && action.controllerIx == 0) {
            slot0Identifier = action.identifier;
        }
        if (action.type == ReconcileAction::Type::OpenInput && action.controllerIx == 1) {
            slot1Identifier = action.identifier;
        }
    }
    REQUIRE_TRUE(slot0Identifier == "dev-a");
    REQUIRE_TRUE(slot1Identifier == "dev-b");
    REQUIRE_TRUE(slot0Identifier != slot1Identifier);
}

// full action-sequence pin: Online on X, ref matched to Y (both X and Y present) -> exactly
// Close(X) then Open(Y) in that order, plus UpdateRef (name match) and Resync (output). The
// stored ref's identifier ("stale-id") is absent from present devices, forcing a name-fallback
// match onto Y ("new-id"); the endpoint is currently Online on a *different* present device X
// ("other-dev-id") that the ref does not match at all, so X must be closed before Y opens.
TEST_CASE(reopen_under_different_identifier_pins_close_then_open_then_update_then_resync_order) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Twister", MidiEndpointRef{}, Ref("stale-id", "Twister")));

    MidiDeviceList present;
    present.outputs.push_back({"other-dev-id", "SomeOtherDevice"});   // device X: currently open, unrelated to ref
    present.outputs.push_back({"new-id", "Twister"});                 // device Y: matches stored name

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Online, "other-dev-id")});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 4);
    REQUIRE_TRUE(plan.actions[0].type == ReconcileAction::Type::CloseOutput);
    REQUIRE_TRUE(plan.actions[0].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[0].identifier == "other-dev-id");

    REQUIRE_TRUE(plan.actions[1].type == ReconcileAction::Type::OpenOutput);
    REQUIRE_TRUE(plan.actions[1].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[1].identifier == "new-id");

    REQUIRE_TRUE(plan.actions[2].type == ReconcileAction::Type::UpdateOutputRef);
    REQUIRE_TRUE(plan.actions[2].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[2].identifier == "new-id");
    REQUIRE_TRUE(plan.actions[2].name == "Twister");

    REQUIRE_TRUE(plan.actions[3].type == ReconcileAction::Type::Resync);
    REQUIRE_TRUE(plan.actions[3].controllerIx == 0);
}

// mixed-match contention: slot 0 name-fallbacks to device A while slot 1 exact-identifier-matches
// A -> slot 0 (slot order) wins the claim, slot 1 loses and goes offline. Full plan pinned.
TEST_CASE(mixed_match_contention_name_fallback_slot_wins_over_later_identifier_match_slot) {
    MidiInstrumentConfig instrument;
    // Slot 0: stored id is stale/missing, falls back to name "Twister" -> matches device A.
    instrument.controllers.push_back(Slot("First", Ref("missing-id", "Twister"), MidiEndpointRef{}));
    // Slot 1: stored id is an exact match for device A too.
    instrument.controllers.push_back(Slot("Second", Ref("dev-a", "SomethingElse"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-a", "Twister"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-a"), Conn(MidiEndpointStatus::Unconfigured)});

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 4);

    REQUIRE_TRUE(plan.actions[0].type == ReconcileAction::Type::OpenInput);
    REQUIRE_TRUE(plan.actions[0].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[0].identifier == "dev-a");

    REQUIRE_TRUE(plan.actions[1].type == ReconcileAction::Type::UpdateInputRef);
    REQUIRE_TRUE(plan.actions[1].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[1].identifier == "dev-a");
    REQUIRE_TRUE(plan.actions[1].name == "Twister");

    REQUIRE_TRUE(plan.actions[2].type == ReconcileAction::Type::CloseInput);
    REQUIRE_TRUE(plan.actions[2].controllerIx == 1);
    REQUIRE_TRUE(plan.actions[2].identifier == "dev-a");

    REQUIRE_TRUE(plan.actions[3].type == ReconcileAction::Type::MarkInputOffline);
    REQUIRE_TRUE(plan.actions[3].controllerIx == 1);
}

// startup-shaped reconcile (Plan 3 Task 3, sar-5; Task 3 review, Important):
// mirrors exactly what MidiConnectionManager::StartupReconcile() drives.
// StartupReconcile() first calls ResizeToControllerCount() (which sizes
// state_.controllers to the current controller count, every entry
// default/Unconfigured -- "the empty MidiConnectionState{} the brief
// describes as `current`", per MidiConnectionManager.hpp's own doc comment)
// and only THEN runs Reconcile() -- so by the time
// PlanMidiReconciliation/ExecuteReconcilePlan actually run, `current` already
// has one Unconfigured/Unconfigured entry per controller, not zero entries.
// This test reproduces exactly that: a two-controller instrument where only
// controller 0's device is currently present, against a `current` pre-sized
// to two Unconfigured entries. Controller 0 must plan an open (-> Online
// once executed); controller 1's ref IS configured but matches no present
// device, so per the binding rule "an endpoint whose stored ref is
// configured but matches no present device SHALL end Offline -- including
// from status Unconfigured (the startup shape)" it must plan a
// MarkInputOffline (no Close*, since nothing is open to close -- this is the
// Unconfigured->Offline transition, not a close-then-offline transition).
// Executing the plan via ExecuteReconcilePlan (the same call
// StartupReconcile() makes through MidiConnectionManager::Reconcile()) must
// land controller 0 Online and controller 1 explicitly Offline (never a
// startup failure -- no op is invoked for controller 1, its endpoint simply
// converges to the "not connected" terminal state instead of lingering in
// the transient Unconfigured-at-startup shape), with zero op failures
// reported for either controller.
TEST_CASE(startup_shaped_reconcile_one_of_two_controllers_present_no_failure) {
    MidiInstrumentConfig instrument;
    instrument.controllers.push_back(Slot("Present", Ref("dev-0", "Controller0"), MidiEndpointRef{}));
    instrument.controllers.push_back(Slot("Absent", Ref("dev-1", "Controller1"), MidiEndpointRef{}));

    MidiDeviceList present;
    present.inputs.push_back({"dev-0", "Controller0"});
    // dev-1 (controller 1's configured device) is NOT present.

    MidiConnectionState current;  // ResizeToControllerCount()'s post-resize shape:
    current.controllers.resize(2);  // two default (Unconfigured/Unconfigured) entries

    ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    // Controller 0: exactly one action, an OpenInput for dev-0.
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenInput) == 1);
    const auto* open = FindAction(plan, ReconcileAction::Type::OpenInput);
    REQUIRE_TRUE(open != nullptr);
    REQUIRE_TRUE(open->controllerIx == 0);
    REQUIRE_TRUE(open->identifier == "dev-0");

    // Controller 1: its device is absent. It was never open (Unconfigured
    // connection status), so there is nothing to Close* -- but its ref IS
    // configured, so it must still be planned Offline (Unconfigured->Offline
    // is a real transition, not inert).
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::CloseInput) == 0);
    const auto* offline = FindAction(plan, ReconcileAction::Type::MarkInputOffline);
    REQUIRE_TRUE(offline != nullptr);
    REQUIRE_TRUE(offline->controllerIx == 1);
    for (const auto& action : plan.actions) {
        if (action.controllerIx == 1) {
            REQUIRE_TRUE(action.type == ReconcileAction::Type::MarkInputOffline);
        }
    }

    synth::MidiEndpointOps ops;
    std::size_t openInputCalls = 0;
    ops.openInput = [&](std::size_t ix, const std::string& identifier) {
        ++openInputCalls;
        REQUIRE_TRUE(ix == 0);
        REQUIRE_TRUE(identifier == "dev-0");
        return true;  // controller 0's device opens successfully
    };

    MidiConnectionState result = synth::ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(openInputCalls == 1);
    REQUIRE_TRUE(result.controllers.size() == 2);
    REQUIRE_TRUE(result.controllers[0].input.status == MidiEndpointStatus::Online);
    REQUIRE_TRUE(result.controllers[0].input.openIdentifier == "dev-0");
    // Controller 1 was marked Offline by the plan -- never a reported open
    // failure (openInputCalls == 1, never called for ix == 1), and no longer
    // left sitting in the transient startup Unconfigured shape.
    REQUIRE_TRUE(result.controllers[1].input.status == MidiEndpointStatus::Offline);
    REQUIRE_TRUE(result.controllers[1].input.status != MidiEndpointStatus::Online);
}

// A Blacklisted slot is not a reconciliation candidate: its populated refs
// remain configured data, while its connection state is explicitly made
// Unconfigured. The immediately following Active slot must still be able to
// claim the same physical devices in slot order.
TEST_CASE(blacklisted_slot_is_inert_and_does_not_claim_devices_needed_by_active_slot) {
    MidiInstrumentConfig instrument;
    MidiControllerSlot blacklisted = Slot("ignored", Ref("in-1", "Twister In"), Ref("out-1", "Twister Out"));
    blacklisted.disposition = synth::MidiControllerDisposition::Blacklisted;
    instrument.controllers.push_back(blacklisted);
    instrument.controllers.push_back(Slot("active", Ref("in-1", "Twister In"), Ref("out-1", "Twister Out")));

    MidiDeviceList present;
    present.inputs.push_back({"in-1", "Twister In"});
    present.outputs.push_back({"out-1", "Twister Out"});

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Offline)});
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Offline)});

    const ReconcilePlan plan = PlanMidiReconciliation(instrument, present, current);

    REQUIRE_TRUE(plan.actions.size() == 5);
    REQUIRE_TRUE(plan.actions[0].type == ReconcileAction::Type::MarkInputUnconfigured);
    REQUIRE_TRUE(plan.actions[0].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[1].type == ReconcileAction::Type::OpenInput);
    REQUIRE_TRUE(plan.actions[1].controllerIx == 1);
    REQUIRE_TRUE(plan.actions[2].type == ReconcileAction::Type::MarkOutputUnconfigured);
    REQUIRE_TRUE(plan.actions[2].controllerIx == 0);
    REQUIRE_TRUE(plan.actions[3].type == ReconcileAction::Type::OpenOutput);
    REQUIRE_TRUE(plan.actions[3].controllerIx == 1);
    REQUIRE_TRUE(plan.actions[4].type == ReconcileAction::Type::Resync);
    REQUIRE_TRUE(plan.actions[4].controllerIx == 1);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::MarkOutputUnconfigured) == 1);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::MarkInputOffline) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::MarkOutputOffline) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::UpdateInputRef) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::UpdateOutputRef) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::Resync) == 1);
}

// Even when no matching endpoint is present, Blacklisted populated refs do
// not take the configured-but-absent Offline path; they converge to the
// connection-only Unconfigured state instead.
TEST_CASE(blacklisted_slot_with_absent_populated_refs_marks_unconfigured_not_offline) {
    MidiInstrumentConfig instrument;
    MidiControllerSlot blacklisted = Slot("ignored", Ref("gone-in", "Gone In"), Ref("gone-out", "Gone Out"));
    blacklisted.disposition = synth::MidiControllerDisposition::Blacklisted;
    instrument.controllers.push_back(blacklisted);

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Offline)});

    const ReconcilePlan plan = PlanMidiReconciliation(instrument, MidiDeviceList{}, current);

    REQUIRE_TRUE(plan.actions.size() == 2);
    REQUIRE_TRUE(plan.actions[0].type == ReconcileAction::Type::MarkInputUnconfigured);
    REQUIRE_TRUE(plan.actions[1].type == ReconcileAction::Type::MarkOutputUnconfigured);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::MarkInputOffline) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::MarkOutputOffline) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenInput) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::OpenOutput) == 0);
    REQUIRE_TRUE(CountActions(plan, ReconcileAction::Type::Resync) == 0);
}

// A disposition transition closes any live endpoint before its generic
// Unconfigured state transition; executing the plan leaves a converged state
// whose next plan is empty.
TEST_CASE(active_to_blacklisted_closes_online_endpoints_then_converges_unconfigured) {
    MidiInstrumentConfig instrument;
    MidiControllerSlot blacklisted = Slot("ignored", Ref("in-1", "Twister In"), Ref("out-1", "Twister Out"));
    blacklisted.disposition = synth::MidiControllerDisposition::Blacklisted;
    instrument.controllers.push_back(blacklisted);

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Online, "in-1"),
                                   Conn(MidiEndpointStatus::Online, "out-1")});

    const ReconcilePlan plan = PlanMidiReconciliation(instrument, MidiDeviceList{}, current);

    REQUIRE_TRUE(plan.actions.size() == 4);
    REQUIRE_TRUE(plan.actions[0].type == ReconcileAction::Type::CloseInput);
    REQUIRE_TRUE(plan.actions[1].type == ReconcileAction::Type::MarkInputUnconfigured);
    REQUIRE_TRUE(plan.actions[2].type == ReconcileAction::Type::CloseOutput);
    REQUIRE_TRUE(plan.actions[3].type == ReconcileAction::Type::MarkOutputUnconfigured);

    synth::MidiEndpointOps ops;
    MidiConnectionState converged = synth::ExecuteReconcilePlan(plan, current, ops);
    REQUIRE_TRUE(converged.controllers[0].input.status == MidiEndpointStatus::Unconfigured);
    REQUIRE_TRUE(converged.controllers[0].output.status == MidiEndpointStatus::Unconfigured);
    REQUIRE_TRUE(PlanMidiReconciliation(instrument, MidiDeviceList{}, converged).actions.empty());
}

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
