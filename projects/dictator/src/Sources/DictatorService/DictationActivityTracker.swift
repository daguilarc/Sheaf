import Foundation

actor DictationActivityTracker
{
    enum State: String, Sendable
    {
        case idle
        case recording
        case processing

        var apiValue: String
        {
            switch self
            {
            case .idle:
                return "idle"
            case .recording, .processing:
                return "processing"
            }
        }
    }

    private var state: State = .idle

    func beginRecording()
    {
        state = .recording
    }

    func beginProcessing()
    {
        state = .processing
    }

    func endActivity()
    {
        state = .idle
    }

    func endProcessing()
    {
        endActivity()
    }

    func currentState() -> State
    {
        state
    }

    func isActive() -> Bool
    {
        state != .idle
    }
}
