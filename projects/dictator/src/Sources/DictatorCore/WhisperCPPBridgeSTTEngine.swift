import Foundation

public protocol WhisperRuntime: Sendable {
    func transcribe(
        audioFileURL: URL,
        modelPath: String,
        language: String,
        decodeMode: TranscriptionDecodeMode
    ) async throws -> TranscribeResponse
}

public struct WhisperCPPBridgeSTTEngine: STTEngine {
    public struct Configuration: Sendable {
        public let modelPath: String
        public let language: String

        public init(modelPath: String, language: String = "en") {
            self.modelPath = modelPath
            self.language = language
        }
    }

    private let configuration: Configuration
    private let runtime: any WhisperRuntime

    public init(
        configuration: Configuration = .init(modelPath: RuntimeConfigFile.defaultSTTModelPath, language: RuntimeConfigFile.defaultSTTLanguage),
        runtime: (any WhisperRuntime)? = nil
    ) {
        self.configuration = configuration
        self.runtime = runtime ?? WhisperCppNativeRuntime()
    }

    public func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse {
        guard let audioData = Data(base64Encoded: request.audio_b64) else {
            throw DictatorError.sttFailed("invalid base64 audio payload")
        }

        let fileManager = FileManager.default
        let tempDir = fileManager.temporaryDirectory.appendingPathComponent("dictator-whisper-\(UUID().uuidString)")
        let audioURL = tempDir.appendingPathComponent("input.wav")

        do {
            try fileManager.createDirectory(at: tempDir, withIntermediateDirectories: true)
            try audioData.write(to: audioURL, options: .atomic)
            defer { try? fileManager.removeItem(at: tempDir) }

            return try await runtime.transcribe(
                audioFileURL: audioURL,
                modelPath: configuration.modelPath,
                language: configuration.language,
                decodeMode: request.decode_mode
            )
        } catch let error as DictatorError {
            throw error
        } catch {
            throw DictatorError.sttFailed(String(describing: error))
        }
    }

    public static func parseWhisperJSON(_ data: Data) throws -> TranscribeResponse {
        let payload = try JSONDecoder().decode(WhisperOutput.self, from: data)

        let segments = payload.transcription.map {
            TranscribeSegment(start_ms: Int($0.offsets.from / 10), end_ms: Int($0.offsets.to / 10), text: $0.text)
        }

        let transcript = payload.text?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? segments.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)

        let confidence: Double
        if segments.isEmpty {
            confidence = 0.0
        } else {
            let probs = payload.transcription.compactMap { $0.avg_logprob.map(exp) }
            confidence = probs.isEmpty ? 0.0 : probs.reduce(0, +) / Double(probs.count)
        }

        let duration = segments.last?.end_ms ?? 0
        return TranscribeResponse(raw_transcript: transcript, segments: segments, confidence: confidence, duration_ms: duration)
    }
}

public struct WhisperCppNativeRuntime: WhisperRuntime {
    public init() {}

    public func transcribe(
        audioFileURL: URL,
        modelPath: String,
        language: String,
        decodeMode: TranscriptionDecodeMode
    ) async throws -> TranscribeResponse {
        #if canImport(CWhisper) && canImport(AVFoundation)
        do {
            return try runNativeTranscription(
                audioFileURL: audioFileURL,
                modelPath: modelPath,
                language: language,
                decodeMode: decodeMode
            )
        } catch let error as DictatorError {
            throw error
        } catch {
            throw DictatorError.sttFailed(String(describing: error))
        }
        #else
        throw DictatorError.sttFailed("native whisper runtime is not linked in this build")
        #endif
    }

    static func makeDecodingOptions(for decodeMode: TranscriptionDecodeMode) -> WhisperDecodingOptions {
        switch decodeMode {
        case .standard:
            return WhisperDecodingOptions(
                initialPrompt: nil,
                suppressRegex: nil,
                useTalonGuidance: false
            )
        case .talonLite:
            return WhisperDecodingOptions(
                initialPrompt: TalonLiteWhisperGuidance.initialPrompt,
                suppressRegex: nil,
                useTalonGuidance: true
            )
        }
    }
}

struct WhisperDecodingOptions: Equatable {
    let initialPrompt: String?
    let suppressRegex: String?
    let useTalonGuidance: Bool
}

private enum TalonLiteWhisperGuidance {
    private static let closedClassWords: [String] = {
        let operatorWords = TalonLiteGrammarParser.allOperatorTokens.flatMap { $0 }
        let characterWords = Array(TalonLiteGrammarParser.characterTokens)
        return Array(Set(operatorWords + characterWords + [TalonLiteGrammarParser.bangLiteral])).sorted()
    }()

    static let initialPrompt: String = closedClassWords.joined(separator: " ")

    static let boostedWords: Set<String> = Set(closedClassWords)
}

#if canImport(CWhisper) && canImport(AVFoundation)
import AVFoundation
import CWhisper

private func runNativeTranscription(
    audioFileURL: URL,
    modelPath: String,
    language: String,
    decodeMode: TranscriptionDecodeMode
) throws -> TranscribeResponse {
    let samples = try readMonoFloatSamples(at: audioFileURL, targetSampleRate: 16_000)
    guard !samples.isEmpty else {
        return TranscribeResponse(raw_transcript: "", segments: [], confidence: 0, duration_ms: 0)
    }

    let cparams = whisper_context_default_params()
    guard let ctx = modelPath.withCString({ whisper_init_from_file_with_params($0, cparams) }) else {
        throw DictatorError.sttFailed("failed to load whisper model at \(modelPath)")
    }
    defer { whisper_free(ctx) }

    var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
    params.n_threads = Int32(max(1, ProcessInfo.processInfo.processorCount - 1))
    params.print_progress = false
    params.print_realtime = false
    params.print_timestamps = false
    params.no_timestamps = false
    params.suppress_blank = true
    params.suppress_nst = true

    let decodingOptions = WhisperCppNativeRuntime.makeDecodingOptions(for: decodeMode)
    let guidanceState = decodingOptions.useTalonGuidance ? TalonLiteWhisperLogitsFilterState(context: ctx) : nil
    if let initialPrompt = decodingOptions.initialPrompt {
        let duplicated = strdup(initialPrompt)
        params.initial_prompt = duplicated.map { UnsafePointer($0) }
        params.carry_initial_prompt = true
    }
    if let suppressRegex = decodingOptions.suppressRegex {
        let duplicated = strdup(suppressRegex)
        params.suppress_regex = duplicated.map { UnsafePointer($0) }
    }
    if let guidanceState {
        params.logits_filter_callback = talonLiteLogitsFilterCallback
        params.logits_filter_callback_user_data = Unmanaged.passRetained(guidanceState).toOpaque()
    }
    defer {
        if let prompt = params.initial_prompt {
            free(UnsafeMutableRawPointer(mutating: prompt))
        }
        if let suppressRegex = params.suppress_regex {
            free(UnsafeMutableRawPointer(mutating: suppressRegex))
        }
        if let userData = params.logits_filter_callback_user_data {
            Unmanaged<TalonLiteWhisperLogitsFilterState>.fromOpaque(userData).release()
        }
    }

    _ = modelPath
    let runResult: Int32 = language.withCString { langPtr in
        params.language = langPtr
        params.detect_language = false
        return samples.withUnsafeBufferPointer {
            whisper_full(ctx, params, $0.baseAddress, Int32($0.count))
        }
    }

    guard runResult == 0 else {
        throw DictatorError.sttFailed("whisper native inference failed (code=\(runResult))")
    }

    let segmentCount = Int(whisper_full_n_segments(ctx))
    var segments: [TranscribeSegment] = []
    segments.reserveCapacity(segmentCount)

    var transcript = ""
    var tokenProbSum: Double = 0
    var tokenProbCount: Int = 0

    for i in 0 ..< segmentCount {
        let t0 = whisper_full_get_segment_t0(ctx, Int32(i))
        let t1 = whisper_full_get_segment_t1(ctx, Int32(i))
        let textPtr = whisper_full_get_segment_text(ctx, Int32(i))
        let text = textPtr.map { String(cString: $0) } ?? ""

        segments.append(
            TranscribeSegment(
                start_ms: Int(t0 * 10),
                end_ms: Int(t1 * 10),
                text: text
            )
        )
        transcript += text

        let tokenCount = Int(whisper_full_n_tokens(ctx, Int32(i)))
        for tokenIndex in 0 ..< tokenCount {
            tokenProbSum += Double(whisper_full_get_token_p(ctx, Int32(i), Int32(tokenIndex)))
            tokenProbCount += 1
        }
    }

    let confidence = tokenProbCount > 0 ? tokenProbSum / Double(tokenProbCount) : 0
    let durationMs = segments.last?.end_ms ?? 0

    return TranscribeResponse(
        raw_transcript: transcript.trimmingCharacters(in: .whitespacesAndNewlines),
        segments: segments,
        confidence: confidence,
        duration_ms: durationMs
    )
}

private final class TalonLiteWhisperLogitsFilterState {
    private let tokenAdjustments: [Float]

    init(context: OpaquePointer) {
        let vocabCount = Int(whisper_n_vocab(context))
        var adjustments = Array(repeating: Float(0), count: vocabCount)

        for tokenID in 0 ..< vocabCount {
            guard let rawPtr = whisper_token_to_str(context, whisper_token(tokenID)) else {
                continue
            }

            let raw = String(cString: rawPtr)
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                continue
            }

            if TalonLiteWhisperGuidance.boostedWords.contains(trimmed) {
                adjustments[tokenID] += 3.5
            }

            let lettersOnly = trimmed.unicodeScalars.allSatisfy { CharacterSet.letters.contains($0) || CharacterSet.whitespaces.contains($0) || $0 == "'" }
            if lettersOnly {
                adjustments[tokenID] += 0.25
            } else {
                adjustments[tokenID] -= 2.5
            }

            if trimmed.rangeOfCharacter(from: .decimalDigits) != nil {
                adjustments[tokenID] -= 1.5
            }
        }

        tokenAdjustments = adjustments
    }

    func apply(to logits: UnsafeMutablePointer<Float>?) {
        guard let logits else {
            return
        }

        for (index, adjustment) in tokenAdjustments.enumerated() where adjustment != 0 {
            logits[index] += adjustment
        }
    }
}

private let talonLiteLogitsFilterCallback: whisper_logits_filter_callback = { _, _, _, _, logits, userData in
    guard let userData else {
        return
    }

    Unmanaged<TalonLiteWhisperLogitsFilterState>
        .fromOpaque(userData)
        .takeUnretainedValue()
        .apply(to: logits)
}

private func readMonoFloatSamples(at url: URL, targetSampleRate: Double) throws -> [Float] {
    let file = try AVAudioFile(forReading: url)
    let sourceFormat = file.processingFormat

    guard let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: targetSampleRate,
        channels: 1,
        interleaved: false
    ) else {
        throw DictatorError.sttFailed("failed to create target audio format")
    }

    let sourceFrames = AVAudioFrameCount(file.length)
    guard let sourceBuffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: sourceFrames) else {
        throw DictatorError.sttFailed("failed to allocate source audio buffer")
    }
    try file.read(into: sourceBuffer)

    let outputBuffer: AVAudioPCMBuffer
    if sourceFormat.sampleRate == targetFormat.sampleRate,
       sourceFormat.channelCount == 1,
       sourceFormat.commonFormat == .pcmFormatFloat32,
       let mono = sourceBuffer.floatChannelData?[0]
    {
        let frameLength = Int(sourceBuffer.frameLength)
        return Array(UnsafeBufferPointer(start: mono, count: frameLength))
    } else {
        guard let converter = AVAudioConverter(from: sourceFormat, to: targetFormat) else {
            throw DictatorError.sttFailed("failed to create audio converter")
        }

        let ratio = targetFormat.sampleRate / sourceFormat.sampleRate
        let outCapacity = AVAudioFrameCount((Double(sourceBuffer.frameLength) * ratio).rounded(.up)) + 8
        guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outCapacity) else {
            throw DictatorError.sttFailed("failed to allocate output audio buffer")
        }

        var provided = false
        var conversionError: NSError?
        let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
            if provided {
                outStatus.pointee = .endOfStream
                return nil
            }
            provided = true
            outStatus.pointee = .haveData
            return sourceBuffer
        }

        if status == .error {
            throw DictatorError.sttFailed("audio conversion failed: \(conversionError?.localizedDescription ?? "unknown")")
        }
        outputBuffer = converted
    }

    guard let mono = outputBuffer.floatChannelData?[0] else {
        throw DictatorError.sttFailed("converted audio buffer missing mono channel")
    }

    let frameLength = Int(outputBuffer.frameLength)
    return Array(UnsafeBufferPointer(start: mono, count: frameLength))
}
#endif

private struct WhisperOutput: Decodable {
    struct Segment: Decodable {
        struct Offsets: Decodable {
            let from: Int
            let to: Int
        }

        let text: String
        let offsets: Offsets
        let avg_logprob: Double?
    }

    let text: String?
    let transcription: [Segment]
}
