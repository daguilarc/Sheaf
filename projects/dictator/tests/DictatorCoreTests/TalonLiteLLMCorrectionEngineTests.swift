import Foundation
import XCTest
@testable import DictatorCore

final class TalonLiteLLMCorrectionEngineTests: XCTestCase {
    override func tearDown() {
        URLProtocol.unregisterClass(TalonLiteURLProtocolStub.self)
        super.tearDown()
    }

    func testOpenAICorrectionReturnsPlainTextOutput() async throws {
        let session = makeSession()
        TalonLiteURLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/responses")
            let payload = #"{"output_text":"hammer yes no blark"}"#.data(using: .utf8)!
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                payload
            )
        }

        let engine = OpenAITalonLiteLLMCorrectionEngine(
            model: "gpt-4.1-mini",
            secretStore: TestSecretStore(key: "test-key"),
            session: session
        )

        let corrected = try await engine.correctToGrammar("hamer yes no")
        XCTAssertEqual(corrected, "hammer yes no blark")
    }

    func testOpenAICorrectionRejectsMissingOutputText() async {
        let session = makeSession()
        TalonLiteURLProtocolStub.handler = { request in
            let payload = #"{"output":[]}"#.data(using: .utf8)!
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                payload
            )
        }

        let engine = OpenAITalonLiteLLMCorrectionEngine(
            model: "gpt-4.1-mini",
            secretStore: TestSecretStore(key: "test-key"),
            session: session
        )

        do {
            _ = try await engine.correctToGrammar("hamer yes no")
            XCTFail("Expected failure")
        } catch let error as DictatorError {
            guard case let .talonPipelineFailed(reason) = error else {
                return XCTFail("Unexpected DictatorError: \(error)")
            }
            XCTAssertTrue(reason.contains("llm_correction"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testOllamaCorrectionReturnsPlainTextOutput() async throws {
        let session = makeSession()
        TalonLiteURLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:11434/api/generate")
            let payload = #"{"response":"camel yes no blark"}"#.data(using: .utf8)!
            return (
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                payload
            )
        }

        let engine = OllamaTalonLiteLLMCorrectionEngine(
            host: "http://127.0.0.1:11434",
            model: "qwen2.5:7b-instruct",
            session: session
        )

        let corrected = try await engine.correctToGrammar("camel yes no")
        XCTAssertEqual(corrected, "camel yes no blark")
    }

    private func makeSession() -> URLSession {
        URLProtocol.registerClass(TalonLiteURLProtocolStub.self)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [TalonLiteURLProtocolStub.self]
        return URLSession(configuration: config)
    }
}

private struct TestSecretStore: SecretStore {
    let key: String?

    func getOpenAIKey() throws -> String? { key }
    func setOpenAIKey(_ key: String) throws {}
    func clearOpenAIKey() throws {}
}

private final class TalonLiteURLProtocolStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
