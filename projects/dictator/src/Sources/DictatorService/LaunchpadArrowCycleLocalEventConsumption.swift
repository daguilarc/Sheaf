import AppKit

struct LaunchpadArrowCycleLocalEventConsumption {
    static func shouldConsume(
        eventType: NSEvent.EventType,
        isArrowKey: Bool,
        isHoldCycleSessionActive: Bool
    ) -> Bool {
        eventType == .keyDown && isArrowKey && isHoldCycleSessionActive
    }
}
