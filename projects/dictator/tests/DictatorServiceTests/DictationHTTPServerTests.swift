import Darwin
import DictatorCore
import Foundation
import XCTest
@testable import DictatorService

final class DictationHTTPServerTests: XCTestCase
{
    private var server: DictationHTTPServer?
    private var port: Int = 0
    private var fakeClient = FakeDictatorCoreClient()
    private var fakeTalon = FakeTalonControl()
    private var shutdownCalled = false
    private var successRecords: [DictationHTTPSuccessRecord] = []
    private var failureRecords: [DictationHTTPFailureRecord] = []

    override func setUp() async throws
    {
        try await super.setUp()
        fakeClient = FakeDictatorCoreClient()
        fakeTalon = FakeTalonControl()
    }

    override func tearDown() async throws
    {
        if let server
        {
            await server.stop()
        }
        server = nil
        try await super.tearDown()
    }

    func testHealthReturnsSheafShape() async throws
    {
        try await startServer(healthWarning: "test warning")
        let (status, body) = try await request(method: "GET", path: "/health")
        XCTAssertEqual(status, 200)
        XCTAssertEqual(body["healthy"] as? Bool, true)
        XCTAssertNotNil(body["uptime"] as? Double)
        XCTAssertEqual(body["warning"] as? String, "test warning")
    }

    func testExitTriggersShutdownCallback() async throws
    {
        try await startServer()
        let (status, body) = try await request(method: "POST", path: "/exit")
        XCTAssertEqual(status, 200)
        XCTAssertEqual(body["exiting"] as? Bool, true)

        let didShutdown = await waitUntil(timeout: 2)
        {
            self.shutdownCalled
        }
        XCTAssertTrue(didShutdown)
    }

    func testDictateAudioSuccess() async throws
    {
        await fakeClient.setDictateResult(
            .success(
                DictateCallResult(
                    response: DictateResponse(
                        raw_transcript: "hello",
                        revised_text: "Hello.",
                        edit_summary: "capitalized",
                        uncertainty_flags: []
                    ),
                    transcribeMs: 10,
                    refineMs: 20
                )
            )
        )
        try await startServer(recordCallbacks: true)

        let wav = WAVFixture.makeMonoPCM16(sampleRate: 16000)
        let (status, body) = try await dictateRequest(wav: wav)

        XCTAssertEqual(status, 200)
        XCTAssertEqual(body["raw_transcript"] as? String, "hello")
        XCTAssertEqual(body["revised_text"] as? String, "Hello.")
        XCTAssertEqual(body["edit_summary"] as? String, "capitalized")
        XCTAssertEqual(body["transcribe_ms"] as? Int, 10)
        XCTAssertEqual(body["refine_ms"] as? Int, 20)

        let didRecord = await waitUntil(timeout: 2)
        {
            !self.successRecords.isEmpty
        }
        XCTAssertTrue(didRecord)
        XCTAssertEqual(successRecords.first?.sessionID, "session-1")
    }

    func testDictateAudioForcesTalonSleepBeforePipeline() async throws
    {
        await fakeClient.setDictateResult(
            .success(
                DictateCallResult(
                    response: DictateResponse(
                        raw_transcript: "hello",
                        revised_text: "Hello.",
                        edit_summary: "capitalized",
                        uncertainty_flags: []
                    ),
                    transcribeMs: 10,
                    refineMs: 20
                )
            )
        )
        try await startServer()

        let wav = WAVFixture.makeMonoPCM16(sampleRate: 16000)
        let (status, _) = try await dictateRequest(wav: wav)

        let sleepCount = await fakeTalon.sleepCount()
        XCTAssertEqual(status, 200)
        XCTAssertEqual(sleepCount, 1)
    }

    func testUnsupportedContentTypeRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(
            wav: WAVFixture.makeMonoPCM16(sampleRate: 16000),
            contentType: "application/json"
        )
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testMissingSampleRateRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(
            wav: WAVFixture.makeMonoPCM16(sampleRate: 16000),
            sampleRate: nil
        )
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testUnsupportedSampleRateRejected() async throws
    {
        try await startServer()
        let wav = WAVFixture.makeMonoPCM16(sampleRate: 11025)
        let (status, body) = try await dictateRequest(wav: wav, sampleRate: 11025)
        XCTAssertEqual(status, 422)
        XCTAssertTrue((body["error"] as? String ?? "").contains("Unsupported sample rate"))
    }

    func testWAVHeaderSampleRateMismatchRejected() async throws
    {
        try await startServer()
        let wav = WAVFixture.makeMismatchedHeaderRate(headerRate: 16000, wavRate: 44100)
        let (status, body) = try await dictateRequest(wav: wav, sampleRate: 16000)
        XCTAssertEqual(status, 422)
        XCTAssertTrue((body["error"] as? String ?? "").contains("does not match"))
    }

    func testMissingLocaleRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(
            wav: WAVFixture.makeMonoPCM16(sampleRate: 16000),
            locale: nil
        )
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testBlankLocaleRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(
            wav: WAVFixture.makeMonoPCM16(sampleRate: 16000),
            locale: "   "
        )
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testMissingSessionIDRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(
            wav: WAVFixture.makeMonoPCM16(sampleRate: 16000),
            sessionID: nil
        )
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testInvalidContextJSONRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(
            wav: WAVFixture.makeMonoPCM16(sampleRate: 16000),
            contextJSON: "not-json"
        )
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testInvalidStylePrefsJSONRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(
            wav: WAVFixture.makeMonoPCM16(sampleRate: 16000),
            stylePrefsJSON: "[1,2]"
        )
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testOverLargePayloadRejected() async throws
    {
        try await startServer(maxBodyBytes: 128)
        let wav = WAVFixture.makeMonoPCM16(sampleRate: 16000, frameCount: 10_000)
        let (status, body) = try await dictateRequest(wav: wav)
        XCTAssertEqual(status, 413)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testMalformedWAVRejected() async throws
    {
        try await startServer()
        let (status, body) = try await dictateRequest(wav: WAVFixture.makeInvalidHeader(sampleRate: 16000))
        XCTAssertEqual(status, 422)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testPipelineFailureReturnsErrorAndRecordsFailure() async throws
    {
        await fakeClient.setDictateResult(.failure(PipelineTestFailure()))
        try await startServer(recordCallbacks: true)

        let (status, body) = try await dictateRequest(wav: WAVFixture.makeMonoPCM16(sampleRate: 16000))
        XCTAssertEqual(status, 500)
        XCTAssertTrue((body["error"] as? String ?? "").contains("pipeline exploded"))

        let didRecord = await waitUntil(timeout: 2)
        {
            !self.failureRecords.isEmpty
        }
        XCTAssertTrue(didRecord)
        XCTAssertEqual(failureRecords.first?.errorMessage, "pipeline exploded")
    }

    func testRemovedTranscribeRouteReturns404() async throws
    {
        try await startServer()
        let (status, _) = try await request(method: "POST", path: "/v1/transcribe", body: Data("{}".utf8), contentType: "application/json")
        XCTAssertEqual(status, 404)
    }

    func testRemovedRefineRouteReturns404() async throws
    {
        try await startServer()
        let (status, _) = try await request(method: "POST", path: "/v1/refine", body: Data("{}".utf8), contentType: "application/json")
        XCTAssertEqual(status, 404)
    }

    func testWrongMethodOnHealthReturns405() async throws
    {
        try await startServer()
        let (status, _) = try await request(method: "POST", path: "/health")
        XCTAssertEqual(status, 405)
    }

    func testLocaleValidation() throws
    {
        XCTAssertTrue(DictationHTTPValidation.isValidLocale("en"))
        XCTAssertTrue(DictationHTTPValidation.isValidLocale("en-US"))
        XCTAssertTrue(DictationHTTPValidation.isValidLocale("fr-CA"))
        XCTAssertFalse(DictationHTTPValidation.isValidLocale(""))
        XCTAssertFalse(DictationHTTPValidation.isValidLocale(" en"))
        XCTAssertFalse(DictationHTTPValidation.isValidLocale("en\nUS"))
    }

    func testFakeClientTranscribeStillAvailableInternally() async throws
    {
        await fakeClient.setTranscribeResult(
            TranscribeResponse(raw_transcript: "internal", segments: [], confidence: 1.0, duration_ms: 1)
        )
        let response = try await fakeClient.transcribe(
            TranscribeRequest(audio_b64: "", sample_rate: 16000, locale: "en-US", session_id: "s")
        )
        XCTAssertEqual(response.raw_transcript, "internal")
    }

    private func startServer(
        maxBodyBytes: Int = 25 * 1024 * 1024,
        healthWarning: String? = nil,
        recordCallbacks: Bool = false
    ) async throws
    {
        shutdownCalled = false
        successRecords = []
        failureRecords = []

        port = try allocatePort()
        let lifecycle = ServiceLifecycle(
            healthWarning: healthWarning,
            onShutdown:
            {
                self.shutdownCalled = true
            }
        )
        let server = DictationHTTPServer(
            host: "127.0.0.1",
            port: port,
            maxBodyBytes: maxBodyBytes,
            lifecycle: lifecycle,
            coreClient: fakeClient,
            onSuccessRecord: recordCallbacks
            ? { record in
                self.successRecords.append(record)
            }
            : nil,
            onFailureRecord: recordCallbacks
            ? { record in
                self.failureRecords.append(record)
            }
            : nil,
            talonControl: fakeTalon
        )
        try await server.start()
        if let bound = server.boundPort
        {
            port = bound
        }
        self.server = server
        try await Task.sleep(nanoseconds: 50_000_000)
    }

    private func dictateRequest(
        wav: Data,
        sampleRate: Int? = 16000,
        locale: String? = "en-US",
        sessionID: String? = "session-1",
        contentType: String = "audio/wav",
        contextJSON: String? = nil,
        stylePrefsJSON: String? = nil
    ) async throws -> (Int, [String: Any])
    {
        var headers: [String: String] = [
            "Content-Type": contentType
        ]
        if let sampleRate
        {
            headers["X-Sample-Rate"] = String(sampleRate)
        }
        if let locale
        {
            headers["X-Locale"] = locale
        }
        if let sessionID
        {
            headers["X-Session-Id"] = sessionID
        }
        if let contextJSON
        {
            headers["X-Context-Json"] = contextJSON
        }
        if let stylePrefsJSON
        {
            headers["X-Style-Prefs-Json"] = stylePrefsJSON
        }
        return try await request(method: "POST", path: "/v1/dictate-audio", body: wav, headers: headers)
    }

    private func request(
        method: String,
        path: String,
        body: Data = Data(),
        contentType: String? = nil,
        headers: [String: String] = [:]
    ) async throws -> (Int, [String: Any])
    {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
        request.httpMethod = method
        request.httpBody = body
        if let contentType
        {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        for (name, value) in headers
        {
            request.setValue(value, forHTTPHeaderField: name)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return (status, object)
    }

    private func allocatePort() throws -> Int
    {
        let socket = socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else
        {
            throw NSError(domain: "DictationHTTPServerTests", code: 1)
        }
        defer { close(socket) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bindResult = withUnsafePointer(to: &addr)
        { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1)
            { sockaddrPointer in
                Darwin.bind(socket, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else
        {
            throw NSError(domain: "DictationHTTPServerTests", code: 2)
        }

        var bound = sockaddr_in()
        var boundLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &bound)
        { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1)
            { sockaddrPointer in
                getsockname(socket, sockaddrPointer, &boundLength)
            }
        }
        guard nameResult == 0 else
        {
            throw NSError(domain: "DictationHTTPServerTests", code: 3)
        }
        return Int(UInt16(bigEndian: bound.sin_port))
    }

    private func waitUntil(timeout: TimeInterval, condition: @escaping () -> Bool) async -> Bool
    {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline
        {
            if condition()
            {
                return true
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return condition()
    }
}

private actor FakeTalonControl: TalonControlProviding
{
    private var sleeps = 0
    private var wakes = 0
    private var current = TalonControlStatus(state: .asleep, speechEnabled: false, modes: ["sleep"])

    func status() async -> TalonControlStatus
    {
        current
    }

    @discardableResult func sleep() async -> TalonControlStatus
    {
        sleeps += 1
        current = TalonControlStatus(state: .asleep, speechEnabled: false, modes: ["sleep"])
        return current
    }

    @discardableResult func wake() async -> TalonControlStatus
    {
        wakes += 1
        current = TalonControlStatus(state: .awake, speechEnabled: true, modes: ["command"])
        return current
    }

    func sleepCount() -> Int
    {
        sleeps
    }
}

private actor FakeDictatorCoreClient: DictatorCoreClient
{
    private var dictateResult: Result<DictateCallResult, Error> = .success(
        DictateCallResult(
            response: DictateResponse(
                raw_transcript: "",
                revised_text: "",
                edit_summary: "",
                uncertainty_flags: []
            ),
            transcribeMs: 0,
            refineMs: 0
        )
    )
    private var transcribeResult = TranscribeResponse(raw_transcript: "", segments: [], confidence: 0, duration_ms: 0)

    func setDictateResult(_ result: Result<DictateCallResult, Error>)
    {
        dictateResult = result
    }

    func setTranscribeResult(_ result: TranscribeResponse)
    {
        transcribeResult = result
    }

    func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse
    {
        transcribeResult
    }

    func refine(_ request: RefineRequest) async throws -> RefineResponse
    {
        RefineResponse(revised_text: "", edit_summary: "", uncertainty_flags: [])
    }

    func dictate(_ request: DictateRequest) async throws -> DictateCallResult
    {
        try dictateResult.get()
    }

    func interactForRuntimeConfig(_ request: VoiceConfigInteractionRequest) async throws -> VoiceConfigInteractionResult
    {
        throw DictatorError.configInteractionUnavailable
    }
}

private struct PipelineTestFailure: Error, LocalizedError
{
    var errorDescription: String?
    {
        "pipeline exploded"
    }
}
