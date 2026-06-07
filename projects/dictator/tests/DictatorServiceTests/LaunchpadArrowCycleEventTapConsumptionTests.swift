import XCTest
import AppKit
@testable import DictatorService

final class LaunchpadArrowCycleEventTapConsumptionTests: XCTestCase {
    func testConsumesArrowKeyDownWhenHoldCycleSessionIsActive() {
        XCTAssertTrue(
            LaunchpadArrowCycleEventTapConsumption.shouldConsume(
                eventType: .keyDown,
                keyCode: 123,
                isHoldCycleSessionActive: true
            )
        )
    }

    func testDoesNotConsumeArrowKeyDownWhenHoldCycleSessionIsInactive() {
        XCTAssertFalse(
            LaunchpadArrowCycleEventTapConsumption.shouldConsume(
                eventType: .keyDown,
                keyCode: 124,
                isHoldCycleSessionActive: false
            )
        )
    }

    func testDoesNotConsumeNonArrowKeyDownWhenHoldCycleSessionIsActive() {
        XCTAssertFalse(
            LaunchpadArrowCycleEventTapConsumption.shouldConsume(
                eventType: .keyDown,
                keyCode: 0,
                isHoldCycleSessionActive: true
            )
        )
    }

    func testDoesNotConsumeNonKeyDownEvent() {
        XCTAssertFalse(
            LaunchpadArrowCycleEventTapConsumption.shouldConsume(
                eventType: .keyUp,
                keyCode: 123,
                isHoldCycleSessionActive: true
            )
        )
    }
}
