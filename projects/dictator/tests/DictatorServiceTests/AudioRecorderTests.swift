import XCTest
@testable import DictatorService

final class AudioRecorderTests: XCTestCase {
    func testSelectedInputIsAppliedBeforeRecordingStarts() async {
        let selectedInput = ResolvedAudioInput(
            mode: .selected,
            configuredValue: "Scarlett 2i2",
            device: AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2),
            isAvailable: true,
            unavailableReason: nil
        )
        var events: [String] = []
        let recorder = AudioRecorder(
            inputSelectionApplier: { selection in
                events.append("apply:\(selection.device.id)")
                return {
                    events.append("restore:\(selection.device.id)")
                }
            },
            recordingStarter: {
                events.append("record")
                return {
                    .success(CapturedAudio(data: Data([1, 2, 3]), sampleRate: 16_000))
                }
            },
            microphonePermissionProvider: { true }
        )

        let result = await recorder.start(resolvedInput: selectedInput)

        assertSuccess(result)
        XCTAssertEqual(events, ["apply:id-1", "record"])

        let stopResult = recorder.stop()

        guard case let .success(captured) = stopResult else {
            XCTFail("Expected captured audio, got \(stopResult)")
            return
        }
        XCTAssertEqual(captured.data, Data([1, 2, 3]))
        XCTAssertEqual(events, ["apply:id-1", "record", "restore:id-1"])
    }

    func testSelectedInputApplyFailureReturnsSetupFailureWithoutDefaultFallback() async {
        let selectedInput = ResolvedAudioInput(
            mode: .selected,
            configuredValue: "Scarlett 2i2",
            device: AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2),
            isAvailable: true,
            unavailableReason: nil
        )
        var events: [String] = []
        let recorder = AudioRecorder(
            inputSelectionApplier: { selection in
                events.append("apply:\(selection.device.id)")
                return nil
            },
            recordingStarter: {
                events.append("record")
                return {
                    .success(CapturedAudio(data: Data(), sampleRate: 16_000))
                }
            },
            microphonePermissionProvider: { true }
        )

        let result = await recorder.start(resolvedInput: selectedInput)

        assertFailure(result, .recorderSetupFailed)
        XCTAssertEqual(events, ["apply:id-1"])
    }

    func testSelectedInputIsRestoredWhenRecordingSetupThrows() async {
        let selectedInput = ResolvedAudioInput(
            mode: .selected,
            configuredValue: "Scarlett 2i2",
            device: AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2),
            isAvailable: true,
            unavailableReason: nil
        )
        var events: [String] = []
        let recorder = AudioRecorder(
            inputSelectionApplier: { selection in
                events.append("apply:\(selection.device.id)")
                return {
                    events.append("restore:\(selection.device.id)")
                }
            },
            recordingStarter: {
                events.append("record")
                throw NSError(domain: "AudioRecorderTests", code: 1)
            },
            microphonePermissionProvider: { true }
        )

        let result = await recorder.start(resolvedInput: selectedInput)

        assertFailure(result, .recorderSetupFailed)
        XCTAssertEqual(events, ["apply:id-1", "record", "restore:id-1"])
    }

    func testUnavailableSelectedInputFailsBeforeRecorderSetup() async {
        let selectedInput = ResolvedAudioInput(
            mode: .selected,
            configuredValue: "Scarlett 2i2",
            device: nil,
            isAvailable: false,
            unavailableReason: "Audio input not found"
        )
        var didStartRecording = false
        let recorder = AudioRecorder(
            inputSelectionApplier: { _ in {} },
            recordingStarter: {
                didStartRecording = true
                return {
                    .success(CapturedAudio(data: Data(), sampleRate: 16_000))
                }
            },
            microphonePermissionProvider: { true }
        )

        let result = await recorder.start(resolvedInput: selectedInput)

        assertFailure(result, .inputUnavailable)
        XCTAssertFalse(didStartRecording)
    }

    func testSystemDefaultModeDoesNotApplySelectedInput() async {
        let defaultInput = ResolvedAudioInput(
            mode: .systemDefault,
            configuredValue: nil,
            device: AudioInputDevice(id: "default-id", name: "MacBook Microphone", channelCount: 1),
            isAvailable: true,
            unavailableReason: nil
        )
        var events: [String] = []
        let recorder = AudioRecorder(
            inputSelectionApplier: { _ in
                events.append("apply")
                return {}
            },
            recordingStarter: {
                events.append("record")
                return {
                    .success(CapturedAudio(data: Data(), sampleRate: 16_000))
                }
            },
            microphonePermissionProvider: { true }
        )

        let result = await recorder.start(resolvedInput: defaultInput)

        assertSuccess(result)
        XCTAssertEqual(events, ["record"])
    }

    private func assertSuccess(
        _ result: Result<Void, AudioRecorder.RecorderError>,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case .success = result else {
            XCTFail("Expected success, got \(result)", file: file, line: line)
            return
        }
    }

    private func assertFailure(
        _ result: Result<Void, AudioRecorder.RecorderError>,
        _ expectedError: AudioRecorder.RecorderError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard case let .failure(error) = result else {
            XCTFail("Expected failure \(expectedError), got \(result)", file: file, line: line)
            return
        }
        XCTAssertEqual(error, expectedError, file: file, line: line)
    }
}
