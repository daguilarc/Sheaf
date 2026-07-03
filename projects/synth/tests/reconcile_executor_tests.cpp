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

using synth::ExecuteReconcilePlan;
using synth::MidiConnectionState;
using synth::MidiControllerConnection;
using synth::MidiEndpointConnection;
using synth::MidiEndpointOps;
using synth::MidiEndpointStatus;
using synth::ReconcileAction;
using synth::ReconcilePlan;

MidiEndpointConnection Conn(MidiEndpointStatus status, std::string openIdentifier = {}) {
    MidiEndpointConnection conn;
    conn.status = status;
    conn.openIdentifier = std::move(openIdentifier);
    return conn;
}

ReconcileAction Action(ReconcileAction::Type type, std::size_t ix, std::string identifier = {},
                       std::string name = {}) {
    ReconcileAction action;
    action.type = type;
    action.controllerIx = ix;
    action.identifier = std::move(identifier);
    action.name = std::move(name);
    return action;
}

// Records every op invocation in call order, as a simple tagged log, so
// tests can assert both WHICH ops ran and in WHAT ORDER -- the executor's
// binding contract (per MidiReconcile.hpp's doc comment) is strict list-
// order application.
struct FakeOpsLog {
    struct Call {
        std::string op;
        std::size_t ix;
        std::string identifier;
        std::string name;
    };
    std::vector<Call> calls;

    void Record(std::string op, std::size_t ix, std::string identifier = {}, std::string name = {}) {
        calls.push_back({std::move(op), ix, std::move(identifier), std::move(name)});
    }
};

// Builds a MidiEndpointOps wired to `log`, with openInput/openOutput
// returning whatever is found in `openInputResult`/`openOutputResult` for
// the given controllerIx (defaulting to true when absent -- most tests don't
// care about failure).
MidiEndpointOps MakeOps(FakeOpsLog& log, bool openInputResult = true, bool openOutputResult = true) {
    MidiEndpointOps ops;
    ops.openInput = [&log, openInputResult](std::size_t ix, const std::string& identifier) {
        log.Record("openInput", ix, identifier);
        return openInputResult;
    };
    ops.openOutput = [&log, openOutputResult](std::size_t ix, const std::string& identifier) {
        log.Record("openOutput", ix, identifier);
        return openOutputResult;
    };
    ops.closeInput = [&log](std::size_t ix) { log.Record("closeInput", ix); };
    ops.closeOutput = [&log](std::size_t ix) { log.Record("closeOutput", ix); };
    ops.updateInputRef = [&log](std::size_t ix, const std::string& id, const std::string& name) {
        log.Record("updateInputRef", ix, id, name);
    };
    ops.updateOutputRef = [&log](std::size_t ix, const std::string& id, const std::string& name) {
        log.Record("updateOutputRef", ix, id, name);
    };
    ops.resync = [&log](std::size_t ix) { log.Record("resync", ix); };
    return ops;
}

} // namespace

// Plan actions are invoked in list order: a plan mixing controllers/types
// must produce a call log matching the plan's action order exactly, not
// grouped by type or controller.
TEST_CASE(actions_invoked_in_plan_order) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::OpenInput, 1, "dev-b"));
    plan.actions.push_back(Action(ReconcileAction::Type::CloseOutput, 0, "dev-a"));
    plan.actions.push_back(Action(ReconcileAction::Type::OpenOutput, 0, "dev-c"));
    plan.actions.push_back(Action(ReconcileAction::Type::Resync, 0));

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Online, "dev-a")});
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});

    ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(log.calls.size() == 4);
    REQUIRE_TRUE(log.calls[0].op == "openInput");
    REQUIRE_TRUE(log.calls[0].ix == 1);
    REQUIRE_TRUE(log.calls[0].identifier == "dev-b");
    REQUIRE_TRUE(log.calls[1].op == "closeOutput");
    REQUIRE_TRUE(log.calls[1].ix == 0);
    REQUIRE_TRUE(log.calls[2].op == "openOutput");
    REQUIRE_TRUE(log.calls[2].ix == 0);
    REQUIRE_TRUE(log.calls[2].identifier == "dev-c");
    REQUIRE_TRUE(log.calls[3].op == "resync");
    REQUIRE_TRUE(log.calls[3].ix == 0);
}

// A successful OpenInput/OpenOutput moves that endpoint to Online with the
// opened identifier recorded.
TEST_CASE(successful_open_marks_online) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log, /*openInputResult=*/true, /*openOutputResult=*/true);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::OpenInput, 0, "dev-1"));
    plan.actions.push_back(Action(ReconcileAction::Type::OpenOutput, 0, "dev-2"));

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Offline)});

    MidiConnectionState result = ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(result.controllers.size() == 1);
    REQUIRE_TRUE(result.controllers[0].input.status == MidiEndpointStatus::Online);
    REQUIRE_TRUE(result.controllers[0].input.openIdentifier == "dev-1");
    REQUIRE_TRUE(result.controllers[0].output.status == MidiEndpointStatus::Online);
    REQUIRE_TRUE(result.controllers[0].output.openIdentifier == "dev-2");
}

// A failed openInput (ops returns false) leaves the endpoint Offline (never
// Online), and execution continues with the remaining actions in the plan --
// a failed open is not fatal to the rest of the plan.
TEST_CASE(failed_open_input_marks_offline_and_continues) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log, /*openInputResult=*/false, /*openOutputResult=*/true);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::OpenInput, 0, "dev-missing"));
    plan.actions.push_back(Action(ReconcileAction::Type::OpenOutput, 1, "dev-2"));

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Offline), Conn(MidiEndpointStatus::Unconfigured)});
    current.controllers.push_back({Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Offline)});

    MidiConnectionState result = ExecuteReconcilePlan(plan, current, ops);

    // Both ops were still invoked -- the failure of the first did not abort
    // the plan.
    REQUIRE_TRUE(log.calls.size() == 2);
    REQUIRE_TRUE(log.calls[0].op == "openInput");
    REQUIRE_TRUE(log.calls[1].op == "openOutput");

    REQUIRE_TRUE(result.controllers[0].input.status == MidiEndpointStatus::Offline);
    REQUIRE_TRUE(result.controllers[0].input.openIdentifier.empty());
    // The second (unrelated) controller's output still opened successfully.
    REQUIRE_TRUE(result.controllers[1].output.status == MidiEndpointStatus::Online);
    REQUIRE_TRUE(result.controllers[1].output.openIdentifier == "dev-2");
}

// A failed openOutput likewise lands on Offline, not Online.
TEST_CASE(failed_open_output_marks_offline) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log, /*openInputResult=*/true, /*openOutputResult=*/false);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::OpenOutput, 0, "dev-missing"));

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Offline)});

    MidiConnectionState result = ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(result.controllers[0].output.status == MidiEndpointStatus::Offline);
    REQUIRE_TRUE(result.controllers[0].output.openIdentifier.empty());
}

// CloseInput/CloseOutput call the op but do not themselves change status;
// MarkInputOffline/MarkOutputOffline (the planner's follow-up action) is what
// actually transitions status to Offline and clears the stored identifier.
TEST_CASE(close_then_mark_offline_clears_state) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::CloseInput, 0, "dev-1"));
    plan.actions.push_back(Action(ReconcileAction::Type::MarkInputOffline, 0));

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Unconfigured)});

    MidiConnectionState result = ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(log.calls.size() == 1);
    REQUIRE_TRUE(log.calls[0].op == "closeInput");
    REQUIRE_TRUE(result.controllers[0].input.status == MidiEndpointStatus::Offline);
    REQUIRE_TRUE(result.controllers[0].input.openIdentifier.empty());
}

// UpdateInputRef/UpdateOutputRef forward identifier+name to the ops without
// touching connection status.
TEST_CASE(update_ref_forwards_identifier_and_name) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::UpdateInputRef, 0, "dev-1", "Twister"));
    plan.actions.push_back(Action(ReconcileAction::Type::UpdateOutputRef, 0, "dev-2", "Twister Out"));

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Online, "dev-2")});

    ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(log.calls.size() == 2);
    REQUIRE_TRUE(log.calls[0].op == "updateInputRef");
    REQUIRE_TRUE(log.calls[0].identifier == "dev-1");
    REQUIRE_TRUE(log.calls[0].name == "Twister");
    REQUIRE_TRUE(log.calls[1].op == "updateOutputRef");
    REQUIRE_TRUE(log.calls[1].identifier == "dev-2");
    REQUIRE_TRUE(log.calls[1].name == "Twister Out");
}

// Resync is invoked exactly once per planned Resync action (a plan with two
// Resync actions for two different controllers calls ops.resync twice, once
// per controller, in order).
TEST_CASE(resync_invoked_once_per_action) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::Resync, 0));
    plan.actions.push_back(Action(ReconcileAction::Type::Resync, 2));

    MidiConnectionState current;
    current.controllers.resize(3);

    ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(log.calls.size() == 2);
    REQUIRE_TRUE(log.calls[0].op == "resync");
    REQUIRE_TRUE(log.calls[0].ix == 0);
    REQUIRE_TRUE(log.calls[1].op == "resync");
    REQUIRE_TRUE(log.calls[1].ix == 2);
}

// The returned state reflects every action applied, in order, across a plan
// that mixes opens, closes, offline marks, and updates for multiple
// controllers -- an end-to-end sanity check beyond the single-action-type
// tests above.
TEST_CASE(returned_state_reflects_full_plan) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log, /*openInputResult=*/true, /*openOutputResult=*/false);

    ReconcilePlan plan;
    // Controller 0: input reopens under a new identifier.
    plan.actions.push_back(Action(ReconcileAction::Type::CloseInput, 0, "dev-old"));
    plan.actions.push_back(Action(ReconcileAction::Type::OpenInput, 0, "dev-new"));
    plan.actions.push_back(Action(ReconcileAction::Type::UpdateInputRef, 0, "dev-new", "Twister"));
    // Controller 1: output was present but is now gone -> close + offline.
    plan.actions.push_back(Action(ReconcileAction::Type::CloseOutput, 1, "dev-gone"));
    plan.actions.push_back(Action(ReconcileAction::Type::MarkOutputOffline, 1));
    // Controller 2: output open attempt fails.
    plan.actions.push_back(Action(ReconcileAction::Type::OpenOutput, 2, "dev-missing"));

    MidiConnectionState current;
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Online, "dev-old"), Conn(MidiEndpointStatus::Unconfigured)});
    current.controllers.push_back(
        {Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Online, "dev-gone")});
    current.controllers.push_back({Conn(MidiEndpointStatus::Unconfigured), Conn(MidiEndpointStatus::Offline)});

    MidiConnectionState result = ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(result.controllers.size() == 3);
    REQUIRE_TRUE(result.controllers[0].input.status == MidiEndpointStatus::Online);
    REQUIRE_TRUE(result.controllers[0].input.openIdentifier == "dev-new");
    REQUIRE_TRUE(result.controllers[1].output.status == MidiEndpointStatus::Offline);
    REQUIRE_TRUE(result.controllers[1].output.openIdentifier.empty());
    REQUIRE_TRUE(result.controllers[2].output.status == MidiEndpointStatus::Offline);
    REQUIRE_TRUE(result.controllers[2].output.openIdentifier.empty());

    // 6 actions in the plan, but MarkOutputOffline calls no op (see its
    // executor semantics: the preceding Close* already did the real work) --
    // 5 op invocations.
    REQUIRE_TRUE(log.calls.size() == 5);
}

// Executor tolerates a `current` state missing entries for a controllerIx
// the plan targets (mirrors the planner's own precondition tolerance: an
// out-of-range/missing entry is treated as Unconfigured, never a crash), and
// grows the returned state to cover it.
TEST_CASE(missing_current_entry_is_tolerated) {
    FakeOpsLog log;
    MidiEndpointOps ops = MakeOps(log);

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::OpenInput, 2, "dev-1"));

    MidiConnectionState current; // empty -- no entries at all

    MidiConnectionState result = ExecuteReconcilePlan(plan, current, ops);

    REQUIRE_TRUE(result.controllers.size() == 3);
    REQUIRE_TRUE(result.controllers[2].input.status == MidiEndpointStatus::Online);
    REQUIRE_TRUE(result.controllers[2].input.openIdentifier == "dev-1");
}

// A null op (default-constructed std::function) is simply skipped rather
// than crashing -- lets a caller wire only the ops a particular plan needs.
TEST_CASE(null_op_is_skipped_without_crashing) {
    MidiEndpointOps ops; // every std::function member left null

    ReconcilePlan plan;
    plan.actions.push_back(Action(ReconcileAction::Type::CloseInput, 0, "dev-1"));
    plan.actions.push_back(Action(ReconcileAction::Type::Resync, 0));

    MidiConnectionState current;
    current.controllers.push_back({Conn(MidiEndpointStatus::Online, "dev-1"), Conn(MidiEndpointStatus::Unconfigured)});

    // Must not throw/crash.
    ExecuteReconcilePlan(plan, current, ops);
}

// PlanMidiConnectionResize (Task 2 review, Minor): the pure resize-decision
// helper MidiConnectionManager::ResizeToControllerCount delegates to. These
// cases pin down its contract independent of any JUCE handler vector.
using synth::MidiConnectionResizePlan;
using synth::PlanMidiConnectionResize;

TEST_CASE(resize_plan_grow_from_zero_has_no_closes_and_grows_every_index) {
    const MidiConnectionResizePlan plan = PlanMidiConnectionResize(/*oldCount=*/0, /*newCount=*/3);
    REQUIRE_TRUE(plan.closingIx.empty());
    REQUIRE_TRUE(plan.growingIx.size() == 3);
    REQUIRE_TRUE(plan.growingIx[0] == 0);
    REQUIRE_TRUE(plan.growingIx[1] == 1);
    REQUIRE_TRUE(plan.growingIx[2] == 2);
}

TEST_CASE(resize_plan_grow_from_nonzero_only_grows_new_trailing_indices) {
    const MidiConnectionResizePlan plan = PlanMidiConnectionResize(/*oldCount=*/2, /*newCount=*/5);
    REQUIRE_TRUE(plan.closingIx.empty());
    REQUIRE_TRUE(plan.growingIx.size() == 3);
    REQUIRE_TRUE(plan.growingIx[0] == 2);
    REQUIRE_TRUE(plan.growingIx[1] == 3);
    REQUIRE_TRUE(plan.growingIx[2] == 4);
}

TEST_CASE(resize_plan_shrink_closes_every_dropped_trailing_index_and_grows_nothing) {
    const MidiConnectionResizePlan plan = PlanMidiConnectionResize(/*oldCount=*/5, /*newCount=*/2);
    REQUIRE_TRUE(plan.growingIx.empty());
    REQUIRE_TRUE(plan.closingIx.size() == 3);
    REQUIRE_TRUE(plan.closingIx[0] == 2);
    REQUIRE_TRUE(plan.closingIx[1] == 3);
    REQUIRE_TRUE(plan.closingIx[2] == 4);
}

TEST_CASE(resize_plan_shrink_to_zero_closes_every_index) {
    const MidiConnectionResizePlan plan = PlanMidiConnectionResize(/*oldCount=*/4, /*newCount=*/0);
    REQUIRE_TRUE(plan.growingIx.empty());
    REQUIRE_TRUE(plan.closingIx.size() == 4);
    REQUIRE_TRUE(plan.closingIx[0] == 0);
    REQUIRE_TRUE(plan.closingIx[3] == 3);
}

TEST_CASE(resize_plan_same_size_is_a_true_no_op) {
    const MidiConnectionResizePlan plan = PlanMidiConnectionResize(/*oldCount=*/3, /*newCount=*/3);
    REQUIRE_TRUE(plan.closingIx.empty());
    REQUIRE_TRUE(plan.growingIx.empty());
}

TEST_CASE(resize_plan_zero_to_zero_is_a_true_no_op) {
    const MidiConnectionResizePlan plan = PlanMidiConnectionResize(/*oldCount=*/0, /*newCount=*/0);
    REQUIRE_TRUE(plan.closingIx.empty());
    REQUIRE_TRUE(plan.growingIx.empty());
}

TEST_CASE(resize_plan_closing_indices_are_sorted_ascending) {
    // Not just "correct membership" -- the manager's caller relies on
    // ascending order to match the loop order the pre-extraction code used
    // (index 0 upward), so a ClearSinkSync on index 2 is never attempted
    // before index 1's teardown in the same pass finishes, even though
    // ClearSinkSync itself doesn't require ordering between different sinks.
    const MidiConnectionResizePlan plan = PlanMidiConnectionResize(/*oldCount=*/6, /*newCount=*/1);
    REQUIRE_TRUE(plan.closingIx.size() == 5);
    for (std::size_t i = 1; i < plan.closingIx.size(); ++i) {
        REQUIRE_TRUE(plan.closingIx[i - 1] < plan.closingIx[i]);
    }
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
