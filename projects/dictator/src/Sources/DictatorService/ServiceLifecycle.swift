import Foundation

final class ServiceLifecycle: @unchecked Sendable
{
    let startedAt: Date
    let healthWarning: String?
    private let onShutdown: (@Sendable () async -> Void)?

    init(
        startedAt: Date = Date(),
        healthWarning: String? = nil,
        onShutdown: (@Sendable () async -> Void)? = nil
    )
    {
        self.startedAt = startedAt
        self.healthWarning = healthWarning
        self.onShutdown = onShutdown
    }

    func UptimeSeconds() -> Double
    {
        Date().timeIntervalSince(startedAt)
    }

    func RequestShutdown() async
    {
        await onShutdown?()
    }
}
