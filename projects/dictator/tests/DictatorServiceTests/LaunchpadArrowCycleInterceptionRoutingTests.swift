import XCTest
@testable import DictatorService

final class LaunchpadArrowCycleInterceptionRoutingTests: XCTestCase {
    func testRoutesOnlyEventTapWhenEventTapPathIsActive() {
        XCTAssertTrue(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .eventTap,
                path: .eventTap,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
        XCTAssertFalse(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .globalMonitor,
                path: .eventTap,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
        XCTAssertFalse(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .localMonitor,
                path: .eventTap,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
    }

    func testRoutesOnlyMonitorsWhenFallbackPathIsActive() {
        XCTAssertFalse(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .eventTap,
                path: .monitorFallback,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
        XCTAssertTrue(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .globalMonitor,
                path: .monitorFallback,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
        XCTAssertTrue(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .localMonitor,
                path: .monitorFallback,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
    }

    func testDoesNotRouteWhenSessionIsInactiveOrPathDisarmed() {
        XCTAssertFalse(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .eventTap,
                path: .inactive,
                isArrowKey: true,
                isHoldCycleSessionActive: true
            )
        )
        XCTAssertFalse(
            LaunchpadArrowCycleInterceptionRouting.shouldHandleArrowKeyEvent(
                source: .localMonitor,
                path: .monitorFallback,
                isArrowKey: true,
                isHoldCycleSessionActive: false
            )
        )
    }

    func testLifecycleArmsAndDisarmsInterceptionPath() {
        var lifecycle = LaunchpadArrowCycleInterceptionLifecycle()
        XCTAssertEqual(lifecycle.path, .inactive)

        lifecycle.arm(eventTapAvailable: true)
        XCTAssertEqual(lifecycle.path, .eventTap)

        lifecycle.disarm()
        XCTAssertEqual(lifecycle.path, .inactive)

        lifecycle.arm(eventTapAvailable: false)
        XCTAssertEqual(lifecycle.path, .monitorFallback)
    }
}
