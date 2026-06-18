import AVFoundation
import Foundation

public struct CapturedAudio {
    public let data: Data
    public let sampleRate: Int
}

public final class AudioRecorder {
    public enum RecorderError: Error, Equatable {
        case microphonePermissionMissing
        case inputUnavailable
        case recorderSetupFailed
        case startFailed
        case notRecording
        case readFailed
    }

    public struct AudioInputSelection: Sendable, Equatable {
        public let device: AudioInputDevice

        public init(device: AudioInputDevice) {
            self.device = device
        }
    }

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var injectedStopper: (() -> Result<CapturedAudio, RecorderError>)?
    private var inputSelectionRestorer: (() -> Void)?
    private var isStarting = false
    private let stateLock = NSLock()
    private let sampleRate: Int
    private let inputSelectionApplier: (AudioInputSelection) -> (() -> Void)?
    private let recordingStarter: (() throws -> (() -> Result<CapturedAudio, RecorderError>))?
    private let microphonePermissionProvider: (() async -> Bool)?

    public init(
        sampleRate: Int = 16_000,
        inputSelectionApplier: @escaping (AudioInputSelection) -> (() -> Void)? = SystemAudioInputResolver.applySelectedInput,
        recordingStarter: (() throws -> (() -> Result<CapturedAudio, RecorderError>))? = nil,
        microphonePermissionProvider: (() async -> Bool)? = nil
    ) {
        self.sampleRate = sampleRate
        self.inputSelectionApplier = inputSelectionApplier
        self.recordingStarter = recordingStarter
        self.microphonePermissionProvider = microphonePermissionProvider
    }

    public func start() async -> Result<Void, RecorderError> {
        await start(resolvedInput: nil)
    }

    public func start(resolvedInput: ResolvedAudioInput?) async -> Result<Void, RecorderError> {
        let canStart = stateLock.withLock { () -> Bool in
            if recorder != nil || isStarting {
                return false
            }
            isStarting = true
            return true
        }
        guard canStart else {
            return .failure(.startFailed)
        }
        defer {
            stateLock.withLock {
                isStarting = false
            }
        }

        let permitted = await microphonePermissionGranted()
        guard permitted else {
            return .failure(.microphonePermissionMissing)
        }

        let restoreInput: (() -> Void)?
        switch apply(resolvedInput: resolvedInput) {
        case let .success(restorer):
            restoreInput = restorer
        case let .failure(error):
            return .failure(error)
        }

        if let recordingStarter {
            do {
                let stopper = try recordingStarter()
                stateLock.withLock {
                    injectedStopper = stopper
                    inputSelectionRestorer = restoreInput
                }
                return .success(())
            } catch {
                restoreInput?()
                return .failure(.recorderSetupFailed)
            }
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("dictator-recording-\(UUID().uuidString)")
            .appendingPathExtension("wav")

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false
        ]

        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.prepareToRecord()
            guard recorder.record() else {
                restoreInput?()
                return .failure(.startFailed)
            }
            stateLock.withLock {
                self.recorder = recorder
                self.recordingURL = url
                self.inputSelectionRestorer = restoreInput
            }
            return .success(())
        } catch {
            restoreInput?()
            return .failure(.recorderSetupFailed)
        }
    }

    public func stop() -> Result<CapturedAudio, RecorderError> {
        let injected: ((() -> Result<CapturedAudio, RecorderError>), (() -> Void)?)? = stateLock.withLock {
            guard let injectedStopper else {
                return nil
            }
            self.injectedStopper = nil
            let restorer = inputSelectionRestorer
            inputSelectionRestorer = nil
            return (injectedStopper, restorer)
        }
        if let (stopper, restorer) = injected {
            let result = stopper()
            restorer?()
            return result
        }

        let active: (AVAudioRecorder, URL, (() -> Void)?)? = stateLock.withLock {
            guard let recorder, let recordingURL else {
                let restorer = inputSelectionRestorer
                inputSelectionRestorer = nil
                restorer?()
                return nil
            }
            self.recorder = nil
            self.recordingURL = nil
            let restorer = inputSelectionRestorer
            inputSelectionRestorer = nil
            return (recorder, recordingURL, restorer)
        }

        guard let (recorder, recordingURL, restorer) = active else {
            return .failure(.notRecording)
        }

        recorder.stop()
        restorer?()

        do {
            let data = try Data(contentsOf: recordingURL)
            try? FileManager.default.removeItem(at: recordingURL)
            return .success(CapturedAudio(data: data, sampleRate: sampleRate))
        } catch {
            return .failure(.readFailed)
        }
    }

    private func microphonePermissionGranted() async -> Bool {
        if let microphonePermissionProvider {
            return await microphonePermissionProvider()
        }

        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .audio)
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }

    private func apply(resolvedInput: ResolvedAudioInput?) -> Result<(() -> Void)?, RecorderError> {
        guard let resolvedInput else {
            return .success(nil)
        }

        guard resolvedInput.isAvailable else {
            return .failure(.inputUnavailable)
        }

        switch resolvedInput.mode {
        case .systemDefault:
            return .success(nil)
        case .selected:
            guard let device = resolvedInput.device, device.channelCount > 0 else {
                return .failure(.inputUnavailable)
            }
            let selection = AudioInputSelection(device: device)
            guard let restorer = inputSelectionApplier(selection) else {
                return .failure(.recorderSetupFailed)
            }
            return .success(restorer)
        }
    }
}
