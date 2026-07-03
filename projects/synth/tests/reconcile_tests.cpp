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
