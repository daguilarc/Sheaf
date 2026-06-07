import XCTest
import Darwin
@testable import DictatorService

final class LaunchpadAppCycleStateTests: XCTestCase {
    func testFirstForwardStepMovesToImmediateNeighborFromSeededCurrent() {
        var state = LaunchpadAppCycleState()
        XCTAssertTrue(state.start(with: [10, 20, 30], currentPID: 20))

        XCTAssertEqual(state.step(.forward), 30)
    }

    func testFirstBackwardStepMovesToImmediateNeighborFromSeededCurrent() {
        var state = LaunchpadAppCycleState()
        XCTAssertTrue(state.start(with: [10, 20, 30], currentPID: 20))

        XCTAssertEqual(state.step(.backward), 10)
    }

    func testFirstStepCanReanchorToRuntimeCurrentSelection() {
        var state = LaunchpadAppCycleState()
        XCTAssertTrue(state.start(with: [10, 20, 30], currentPID: 10))

        XCTAssertEqual(state.step(.forward, currentPID: 20), 30)
        // Runtime currentPID should only affect first step.
        XCTAssertEqual(state.step(.forward, currentPID: 10), 10)
    }

    func testMissingBaselineUsesDeterministicFallback() {
        var forwardState = LaunchpadAppCycleState()
        XCTAssertTrue(forwardState.start(with: [10, 20, 30], currentPID: 999))
        XCTAssertEqual(forwardState.step(.forward), 20)

        var backwardState = LaunchpadAppCycleState()
        XCTAssertTrue(backwardState.start(with: [10, 20, 30], currentPID: 999))
        XCTAssertEqual(backwardState.step(.backward), 30)
    }

    func testStartCapturesFrozenCandidateOrder() {
        var source: [pid_t] = [101, 202, 303]
        var state = LaunchpadAppCycleState()

        XCTAssertTrue(state.start(with: source, currentPID: 101))
        source.removeAll()

        XCTAssertEqual(state.step(.forward), 202)
        XCTAssertEqual(state.step(.forward), 303)
        XCTAssertEqual(state.step(.forward), 101)
    }

    func testStepWrapsForwardAndBackward() {
        var state = LaunchpadAppCycleState()
        XCTAssertTrue(state.start(with: [10, 20, 30], currentPID: 10))

        XCTAssertEqual(state.step(.forward), 20)
        XCTAssertEqual(state.step(.forward), 30)
        XCTAssertEqual(state.step(.forward), 10)
        XCTAssertEqual(state.step(.backward), 30)
        XCTAssertEqual(state.step(.backward), 20)
    }

    func testStopClearsActiveSessionAndIgnoresFurtherSteps() {
        var state = LaunchpadAppCycleState()
        XCTAssertTrue(state.start(with: [501, 502], currentPID: 501))
        XCTAssertTrue(state.isActive)

        state.stop()

        XCTAssertFalse(state.isActive)
        XCTAssertNil(state.step(.forward))
    }
}
