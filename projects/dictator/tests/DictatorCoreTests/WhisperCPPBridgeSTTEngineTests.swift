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

    func testNativeRuntimeReturnsSTTFailureForInvalidInputFile() async {
        let runtime = WhisperCppNativeRuntime()
        do {
            _ = try await runtime.transcribe(
                audioFileURL: URL(fileURLWithPath: "/tmp/none.wav"),
                modelPath: "model.bin",
                language: "en"
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

    func testWhisperBackendBootstrapLoadsBeforeCountingDevices() throws {
        var events: [String] = []
        let bootstrap = WhisperBackendBootstrap(
            loadBackends: { events.append("load") },
            deviceCount: {
                events.append("count")
                return 2
            }
        )

        let count = try bootstrap.prepareBackendDeviceCount()

        XCTAssertEqual(count, 2)
        XCTAssertEqual(events, ["load", "count"])
    }

    func testWhisperBackendBootstrapLoadsAndCountsExactlyOnce() throws {
        var loadCount = 0
        var countCalls = 0
        let bootstrap = WhisperBackendBootstrap(
            loadBackends: { loadCount += 1 },
            deviceCount: {
                countCalls += 1
                return countCalls
            }
        )

        XCTAssertEqual(try bootstrap.prepareBackendDeviceCount(), 1)
        XCTAssertEqual(try bootstrap.prepareBackendDeviceCount(), 1)
        XCTAssertEqual(loadCount, 1)
        XCTAssertEqual(countCalls, 1)
    }

    func testWhisperBackendBootstrapReusesCachedSuccess() throws {
        var nextCount = 3
        let bootstrap = WhisperBackendBootstrap(
            loadBackends: {},
            deviceCount: {
                defer { nextCount = 0 }
                return nextCount
            }
        )

        XCTAssertEqual(try bootstrap.prepareBackendDeviceCount(), 3)
        XCTAssertEqual(try bootstrap.prepareBackendDeviceCount(), 3)
    }

    func testWhisperBackendBootstrapFailsBeforeModelInitWhenNoDeviceExists() throws {
        let bootstrap = WhisperBackendBootstrap(
            loadBackends: {},
            deviceCount: { 0 }
        )

        do {
            _ = try bootstrap.prepareBackendDeviceCount()
            XCTFail("expected failure")
        } catch let error as DictatorError {
            guard case let .sttFailed(message) = error else {
                XCTFail("unexpected error: \(error)")
                return
            }
            XCTAssertTrue(message.contains("ggml backend"))
            XCTAssertTrue(message.contains("no devices"))
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testNativeRuntimeTranscribesExplicitWhisperFixtureWhenEnabled() async throws {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let fixtureURL = repoRoot.appendingPathComponent("projects/dictator/.native-whisper-fixture.json")
        guard FileManager.default.fileExists(atPath: fixtureURL.path) else {
            throw XCTSkip("Create projects/dictator/.native-whisper-fixture.json to run native Whisper integration")
        }

        let fixture = try JSONDecoder().decode(
            NativeWhisperFixture.self,
            from: try Data(contentsOf: fixtureURL)
        )
        let response = try await WhisperCppNativeRuntime().transcribe(
            audioFileURL: URL(fileURLWithPath: fixture.wav_path),
            modelPath: fixture.model_path,
            language: fixture.language ?? "en"
        )

        XCTAssertGreaterThanOrEqual(response.duration_ms, 0)
    }
}

private struct NativeWhisperFixture: Decodable {
    let model_path: String
    let wav_path: String
    let language: String?
}

private struct StubRuntime: WhisperRuntime {
    let result: Result<TranscribeResponse, Error>

    func transcribe(
        audioFileURL: URL,
        modelPath: String,
        language: String
    ) async throws -> TranscribeResponse {
        try result.get()
    }
}
