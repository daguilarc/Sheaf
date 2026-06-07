import AppKit

enum LaunchpadArrowCycleInterceptionPath: Equatable {
    case inactive
    case eventTap
    case monitorFallback
}

enum LaunchpadArrowCycleInterceptionSource: Equatable {
    case eventTap
    case globalMonitor
    case localMonitor
}

struct LaunchpadArrowCycleInterceptionLifecycle {
    private(set) var path: LaunchpadArrowCycleInterceptionPath = .inactive

    mutating func arm(eventTapAvailable: Bool) {
        path = eventTapAvailable ? .eventTap : .monitorFallback
    }

    mutating func disarm() {
        path = .inactive
    }
}

struct LaunchpadArrowCycleInterceptionRouting {
    static func shouldHandleArrowKeyEvent(
        source: LaunchpadArrowCycleInterceptionSource,
        path: LaunchpadArrowCycleInterceptionPath,
        isArrowKey: Bool,
        isHoldCycleSessionActive: Bool
    ) -> Bool {
        guard isArrowKey && isHoldCycleSessionActive else {
            return false
        }
        switch (path, source) {
        case (.eventTap, .eventTap),
            (.monitorFallback, .globalMonitor),
            (.monitorFallback, .localMonitor):
            return true
        default:
            return false
        }
    }
}

struct LaunchpadArrowCycleEventTapConsumption {
    private static let arrowKeyCodes: Set<Int64> = [123, 124, 125, 126]

    static func shouldConsume(
        eventType: CGEventType,
        keyCode: Int64,
        isHoldCycleSessionActive: Bool
    ) -> Bool {
        eventType == .keyDown && isHoldCycleSessionActive && arrowKeyCodes.contains(keyCode)
    }
}
