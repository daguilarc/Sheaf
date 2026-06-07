import Foundation

public final class RecordingController {
    public private(set) var isRecording = false

    public init() {}

    @discardableResult
    public func toggle() -> Bool {
        isRecording.toggle()
        return isRecording
    }
}
