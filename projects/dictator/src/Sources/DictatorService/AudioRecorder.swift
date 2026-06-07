import AVFoundation
import Foundation

public struct CapturedAudio {
    public let data: Data
    public let sampleRate: Int
}

public final class AudioRecorder {
    public enum RecorderError: Error {
        case microphonePermissionMissing
        case recorderSetupFailed
        case startFailed
        case notRecording
        case readFailed
    }

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var isStarting = false
    private let stateLock = NSLock()
    private let sampleRate: Int

    public init(sampleRate: Int = 16_000) {
        self.sampleRate = sampleRate
    }

    public func start() async -> Result<Void, RecorderError> {
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
                return .failure(.startFailed)
            }
            stateLock.withLock {
                self.recorder = recorder
                self.recordingURL = url
            }
            return .success(())
        } catch {
            return .failure(.recorderSetupFailed)
        }
    }

    public func stop() -> Result<CapturedAudio, RecorderError> {
        let active: (AVAudioRecorder, URL)? = stateLock.withLock {
            guard let recorder, let recordingURL else {
                return nil
            }
            self.recorder = nil
            self.recordingURL = nil
            return (recorder, recordingURL)
        }

        guard let (recorder, recordingURL) = active else {
            return .failure(.notRecording)
        }

        recorder.stop()

        do {
            let data = try Data(contentsOf: recordingURL)
            try? FileManager.default.removeItem(at: recordingURL)
            return .success(CapturedAudio(data: data, sampleRate: sampleRate))
        } catch {
            return .failure(.readFailed)
        }
    }

    private func microphonePermissionGranted() async -> Bool {
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
}
