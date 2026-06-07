import Foundation
import XCTest
@testable import DictatorCore

final class ModelAvailabilityCheckerTests: XCTestCase {
    override func tearDown() {
        URLProtocol.unregisterClass(ModelListURLProtocolStub.self)
        super.tearDown()
    }

    func testResolveModelReturnsClosestOllamaMatch() async throws {
        let session = makeSession()
        ModelListURLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:11434/api/tags")
            let data = #"{"models":[{"name":"qwen2.5:7b-instruct"},{"name":"llama3.2"}]}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }

        let checker = LiveModelAvailabilityChecker(session: session, secretStore: TestSecretStore())
        let resolved = try await checker.resolveModel(
            requestedModel: "qwen2.5",
            useCloud: false,
            configuration: .init(
                provider: .ollama,
                ollamaHost: "http://127.0.0.1:11434",
                ollamaModel: "qwen2.5:7b-instruct",
                fallback: .openai,
                openAIModel: "gpt-4.1-mini"
            )
        )

        XCTAssertEqual(resolved, "qwen2.5:7b-instruct")
    }

    func testResolveModelMapsNetworkErrors() async {
        let session = makeSession()
        ModelListURLProtocolStub.handler = { _ in
            throw URLError(.cannotConnectToHost)
        }

        let checker = LiveModelAvailabilityChecker(session: session, secretStore: TestSecretStore())

        do {
            _ = try await checker.resolveModel(
                requestedModel: "qwen2.5",
                useCloud: false,
                configuration: .init(
                    provider: .ollama,
                    ollamaHost: "http://127.0.0.1:11434",
                    ollamaModel: "qwen2.5:7b-instruct",
                    fallback: .openai,
                    openAIModel: "gpt-4.1-mini"
                )
            )
            XCTFail("Expected network error")
        } catch let error as DictatorError {
            guard case .networkUnavailable = error else {
                return XCTFail("Unexpected DictatorError: \(error)")
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func makeSession() -> URLSession {
        URLProtocol.registerClass(ModelListURLProtocolStub.self)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ModelListURLProtocolStub.self]
        return URLSession(configuration: config)
    }
}

private struct TestSecretStore: SecretStore {
    func getOpenAIKey() throws -> String? { nil }
    func setOpenAIKey(_ key: String) throws {}
    func clearOpenAIKey() throws {}
}

private final class ModelListURLProtocolStub: URLProtocol {
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
