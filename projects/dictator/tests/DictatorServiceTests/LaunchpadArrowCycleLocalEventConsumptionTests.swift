import XCTest
import AppKit
@testable import DictatorService

final class LaunchpadArrowCycleLocalEventConsumptionTests: XCTestCase {
    func testConsumesArrowKeyDownWhenHoldCycleSessionIsActive() {
        XCTAssertTrue(
            LaunchpadArrowCycleLocalEventConsumption.shouldConsume(
                eventType: .keyDown,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
    }

    func testDoesNotConsumeArrowKeyDownWhenHoldCycleSessionIsInactive() {
        XCTAssertFalse(
            LaunchpadArrowCycleLocalEventConsumption.shouldConsume(
                eventType: .keyDown,
                isArrowKey: true,
                isHoldCycleSessionActive: false
            )
        )
    }

    func testDoesNotConsumeNonArrowKeyDownWhenHoldCycleSessionIsActive() {
        XCTAssertFalse(
            LaunchpadArrowCycleLocalEventConsumption.shouldConsume(
                eventType: .keyDown,
                isArrowKey: false,
                isHoldCycleSessionActive: true
            )
        )
    }

    func testDoesNotConsumeNonKeyDownEvent() {
        XCTAssertFalse(
            LaunchpadArrowCycleLocalEventConsumption.shouldConsume(
                eventType: .keyUp,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
    }
}
