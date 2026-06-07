import Foundation
import XCTest
@testable import DictatorCore

final class WhisperCPPBridgeSTTEngineTests: XCTestCase {
    func testParseWhisperJSONMapsContractFields() throws {
        let json = """
        {
          "text": "hello world",
          "transcription": [
            {
              "text": "hello",
              "offsets": { "from": 0, "to": 5000 },
              "avg_logprob": -0.1
            },
            {
              "text": "world",
              "offsets": { "from": 5000, "to": 10000 },
              "avg_logprob": -0.2
            }
          ]
        }
        """.data(using: .utf8)!

        let parsed = try WhisperCPPBridgeSTTEngine.parseWhisperJSON(json)
        XCTAssertEqual(parsed.raw_transcript, "hello world")
        XCTAssertEqual(parsed.segments.count, 2)
        XCTAssertEqual(parsed.segments[0].start_ms, 0)
        XCTAssertEqual(parsed.segments[0].end_ms, 500)
        XCTAssertEqual(parsed.duration_ms, 1000)
        XCTAssertGreaterThan(parsed.confidence, 0)
    }

    func testTranscribeFailsForInvalidBase64() async {
        let engine = WhisperCPPBridgeSTTEngine(
            configuration: .init(modelPath: "model.bin"),
            runtime: StubRuntime(result: .success(TranscribeResponse(raw_transcript: "", segments: [], confidence: 0, duration_ms: 0)))
        )

        do {
            _ = try await engine.transcribe(.init(audio_b64: "not-base64", sample_rate: 16000, locale: "en-US", session_id: "s"))
            XCTFail("expected failure")
        } catch let error as DictatorError {
            guard case .sttFailed = error else {
                XCTFail("unexpected error: \(error)")
                return
            }
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testTranscribeMapsWhisperFailure() async {
        let engine = WhisperCPPBridgeSTTEngine(
            configuration: .init(modelPath: "missing-model.bin"),
            runtime: StubRuntime(result: .failure(DictatorError.sttFailed("whisper.cpp failed: model missing")))
        )

        do {
            _ = try await engine.transcribe(.init(audio_b64: Data("x".utf8).base64EncodedString(), sample_rate: 16000, locale: "en-US", session_id: "s"))
            XCTFail("expected failure")
        } catch let error as DictatorError {
            guard case let .sttFailed(message) = error else {
                XCTFail("unexpected error: \(error)")
                return
            }
            XCTAssertTrue(message.contains("whisper.cpp failed"))
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testTranscribeForwardsDecodeModeToRuntime() async throws {
        let runtime = CapturingRuntime()
        let engine = WhisperCPPBridgeSTTEngine(
            configuration: .init(modelPath: "model.bin"),
            runtime: runtime
        )

        _ = try await engine.transcribe(
            .init(
                audio_b64: Data("x".utf8).base64EncodedString(),
                sample_rate: 16_000,
                locale: "en-US",
                session_id: "s",
                decode_mode: .talonLite
            )
        )

        let lastMode = await runtime.lastMode
        XCTAssertEqual(lastMode, .talonLite)
    }

    func testNativeRuntimeBuildsTalonLiteDecodingOptions() {
        let options = WhisperCppNativeRuntime.makeDecodingOptions(for: .talonLite)

        XCTAssertTrue(options.useTalonGuidance)
        XCTAssertNotNil(options.initialPrompt)
        XCTAssertNil(options.suppressRegex)
    }

    func testNativeRuntimeKeepsStandardDecodingOptionsUnchanged() {
        let options = WhisperCppNativeRuntime.makeDecodingOptions(for: .standard)

        XCTAssertFalse(options.useTalonGuidance)
        XCTAssertNil(options.initialPrompt)
        XCTAssertNil(options.suppressRegex)
    }

    func testNativeRuntimeReturnsSTTFailureForInvalidInputFile() async {
        let runtime = WhisperCppNativeRuntime()
        do {
            _ = try await runtime.transcribe(
                audioFileURL: URL(fileURLWithPath: "/tmp/none.wav"),
                modelPath: "model.bin",
                language: "en",
                decodeMode: .standard
            )
            XCTFail("expected failure")
        } catch let error as DictatorError {
            guard case .sttFailed = error else {
                XCTFail("unexpected error: \(error)")
                return
            }
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}

private struct StubRuntime: WhisperRuntime {
    let result: Result<TranscribeResponse, Error>

    func transcribe(
        audioFileURL: URL,
        modelPath: String,
        language: String,
        decodeMode: TranscriptionDecodeMode
    ) async throws -> TranscribeResponse {
        try result.get()
    }
}

private actor CapturingRuntime: WhisperRuntime {
    var lastMode: TranscriptionDecodeMode?

    func transcribe(
        audioFileURL: URL,
        modelPath: String,
        language: String,
        decodeMode: TranscriptionDecodeMode
    ) async throws -> TranscribeResponse {
        lastMode = decodeMode
        return TranscribeResponse(raw_transcript: "air bat", segments: [], confidence: 1, duration_ms: 100)
    }
}
