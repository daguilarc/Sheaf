import Foundation

actor DictationActivityTracker
{
    enum State: String, Sendable
    {
        case idle
        case processing
    }

    private var state: State = .idle

    func beginProcessing()
    {
        state = .processing
    }

    func endProcessing()
    {
        state = .idle
    }

    func currentState() -> State
    {
        state
    }
}
