import Foundation
import Speech

public final class SpeechFrameworkSTTEngine: STTEngine {
    public init() {}

    public func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse {
        let authorized = await speechPermissionGranted()
        guard authorized else {
            throw DictatorError.permissionsDenied("speech recognition")
        }

        guard let audioData = Data(base64Encoded: request.audio_b64) else {
            throw DictatorError.sttFailed("invalid base64 audio payload")
        }

        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("dictator-stt-\(UUID().uuidString)")
            .appendingPathExtension("caf")
        do {
            try audioData.write(to: tempURL, options: .atomic)
            defer { try? FileManager.default.removeItem(at: tempURL) }

            return try await recognizeFile(at: tempURL, locale: request.locale)
        } catch {
            throw DictatorError.sttFailed(String(describing: error))
        }
    }

    private func recognizeFile(at url: URL, locale: String) async throws -> TranscribeResponse {
        let recognizerLocale = Locale(identifier: locale)
        guard let recognizer = SFSpeechRecognizer(locale: recognizerLocale) ?? SFSpeechRecognizer() else {
            throw DictatorError.sttFailed("no speech recognizer available")
        }
        guard recognizer.isAvailable else {
            throw DictatorError.sttFailed("speech recognizer unavailable")
        }

        return try await withCheckedThrowingContinuation { continuation in
            let request = SFSpeechURLRecognitionRequest(url: url)
            recognizer.recognitionTask(with: request) { result, error in
                if let error {
                    continuation.resume(throwing: DictatorError.sttFailed(error.localizedDescription))
                    return
                }

                guard let result else {
                    continuation.resume(throwing: DictatorError.sttFailed("no recognition result"))
                    return
                }

                if !result.isFinal {
                    return
                }

                let segments = result.bestTranscription.segments.map {
                    TranscribeSegment(
                        start_ms: Int($0.timestamp * 1000),
                        end_ms: Int(($0.timestamp + $0.duration) * 1000),
                        text: $0.substring
                    )
                }
                let confidence = segments.isEmpty
                    ? 0.0
                    : result.bestTranscription.segments.reduce(0.0) { $0 + Double($1.confidence) } / Double(segments.count)
                let duration = segments.last?.end_ms ?? 0
                continuation.resume(
                    returning: TranscribeResponse(
                        raw_transcript: result.bestTranscription.formattedString,
                        segments: segments,
                        confidence: confidence,
                        duration_ms: duration
                    )
                )
            }
        }
    }

    private func speechPermissionGranted() async -> Bool {
        let status = SFSpeechRecognizer.authorizationStatus()
        switch status {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { auth in
                    continuation.resume(returning: auth == .authorized)
                }
            }
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
    }
}
