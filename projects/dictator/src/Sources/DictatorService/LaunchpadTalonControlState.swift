import Foundation

struct LaunchpadTalonControlState: Sendable, Equatable
{
    private(set) var status: TalonControlStatus = .unavailable
    private(set) var wakeBlocked = false

    mutating func refresh(_ newStatus: TalonControlStatus)
    {
        status = newStatus
        wakeBlocked = false
    }

    mutating func recordSleep(_ newStatus: TalonControlStatus)
    {
        status = newStatus
    }

    mutating func recordWake(_ newStatus: TalonControlStatus)
    {
        status = newStatus
        wakeBlocked = false
    }

    mutating func beginWakeAttempt(isDictationActive: Bool) -> Bool
    {
        if isDictationActive
        {
            wakeBlocked = true
            return false
        }
        wakeBlocked = false
        return true
    }

    mutating func clearBlockedWake()
    {
        wakeBlocked = false
    }

    var color: PadColor
    {
        if wakeBlocked
        {
            return PadColor(r: 255, g: 0, b: 0)
        }
        switch status.state
        {
        case .awake:
            return PadColor(r: 0, g: 255, b: 0)
        case .asleep:
            return PadColor(r: 90, g: 60, b: 0)
        case .unavailable, .error:
            return PadColor(r: 60, g: 60, b: 60)
        }
    }
}
