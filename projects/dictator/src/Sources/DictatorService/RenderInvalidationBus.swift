import Foundation

final class RenderInvalidationBus {
    private let condition = NSCondition()
    private var generation: UInt64 = 0

    func markDirty(reason: String) {
        condition.lock()
        generation &+= 1
        condition.broadcast()
        condition.unlock()
        TraceLogger.log("launchpad render dirty (reason=\(reason), generation=\(generation))")
    }

    func waitForDirty(since lastSeenGeneration: UInt64, timeout: TimeInterval) -> UInt64 {
        condition.lock()
        defer { condition.unlock() }

        if generation == lastSeenGeneration {
            _ = condition.wait(until: Date().addingTimeInterval(timeout))
        }

        return generation
    }
}
