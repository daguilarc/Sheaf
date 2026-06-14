import Foundation
import XCTest
@testable import DictatorService

final class TalonControlClientTests: XCTestCase
{
    override func tearDown()
    {
        TalonControlURLProtocolStub.handler = nil
        URLProtocol.unregisterClass(TalonControlURLProtocolStub.self)
        super.tearDown()
    }

    func testStatusMapsAwake() async
    {
        let client = makeClient(status: 200, body: #"{"speech_enabled":true,"mode":["all","command"]}"#)

        let status = await client.status()

        XCTAssertEqual(status.state, .awake)
        XCTAssertEqual(status.speechEnabled, true)
        XCTAssertEqual(status.modes, ["all", "command"])
    }

    func testStatusMapsAsleepWhenSpeechDisabled() async
    {
        let client = makeClient(status: 200, body: #"{"speech_enabled":false,"mode":["all","sleep"]}"#)

        let status = await client.status()

        XCTAssertEqual(status.state, .asleep)
    }

    func testStatusMapsAsleepWhenSleepModePresent() async
    {
        let client = makeClient(status: 200, body: #"{"speech_enabled":true,"mode":["all","sleep"]}"#)

        let status = await client.status()

        XCTAssertEqual(status.state, .asleep)
    }

    func testSleepUsesSleepEndpoint() async
    {
        let capturedRequest = CapturedTalonControlRequest()
        let client = makeClient { request in
            capturedRequest.set(request)
            return (200, #"{"speech_enabled":false,"mode":["sleep"]}"#)
        }

        let status = await client.sleep()
        let captured = capturedRequest.values()

        XCTAssertEqual(status.state, .asleep)
        XCTAssertEqual(captured.method, "POST")
        XCTAssertEqual(captured.path, "/sleep")
    }

    func testWakeUsesWakeEndpoint() async
    {
        let capturedRequest = CapturedTalonControlRequest()
        let client = makeClient { request in
            capturedRequest.set(request)
            return (200, #"{"speech_enabled":true,"mode":["command"]}"#)
        }

        let status = await client.wake()
        let captured = capturedRequest.values()

        XCTAssertEqual(status.state, .awake)
        XCTAssertEqual(captured.method, "POST")
        XCTAssertEqual(captured.path, "/wake")
    }

    func testBridgeErrorMapsError() async
    {
        let client = makeClient(status: 500, body: #"{"error":"boom"}"#)

        let status = await client.status()

        XCTAssertEqual(status.state, .error("boom"))
    }

    func testConnectionFailureMapsUnavailable() async
    {
        let client = makeClient { _ in
            throw URLError(.cannotConnectToHost)
        }

        let status = await client.status()

        XCTAssertEqual(status.state, .unavailable)
    }

    private func makeClient(status: Int, body: String) -> TalonControlClient
    {
        makeClient { _ in (status, body) }
    }

    private func makeClient(
        handler: @escaping @Sendable (URLRequest) throws -> (Int, String)
    ) -> TalonControlClient
    {
        URLProtocol.registerClass(TalonControlURLProtocolStub.self)
        TalonControlURLProtocolStub.handler = handler
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [TalonControlURLProtocolStub.self]
        let session = URLSession(configuration: config)
        return TalonControlClient(baseURL: URL(string: "http://127.0.0.1:28579")!, urlSession: session)
    }
}

private final class CapturedTalonControlRequest: @unchecked Sendable
{
    private let lock = NSLock()
    private var method: String?
    private var path: String?

    func set(_ request: URLRequest)
    {
        lock.withLock
        {
            method = request.httpMethod
            path = request.url?.path
        }
    }

    func values() -> (method: String?, path: String?)
    {
        lock.withLock
        {
            (method, path)
        }
    }
}

private final class TalonControlURLProtocolStub: URLProtocol
{
    static var handler: (@Sendable (URLRequest) throws -> (Int, String))?

    override class func canInit(with request: URLRequest) -> Bool
    {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest
    {
        request
    }

    override func startLoading()
    {
        guard let handler = Self.handler else
        {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do
        {
            let (status, body) = try handler(request)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        catch
        {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
