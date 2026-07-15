import Foundation
import XCTest
@testable import DictatorCore

final class OpenAIRefinementEngineTests: XCTestCase {
    override func tearDown() {
        URLProtocol.unregisterClass(OpenAIURLProtocolStub.self)
        OpenAIURLProtocolStub.handler = nil
        super.tearDown()
    }

    func testRefineIncludesConfiguredReasoningEffort() async throws {
        let session = makeSession()
        OpenAIURLProtocolStub.handler = { request in
            let body = try XCTUnwrap(request.httpBodyData())
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let reasoning = try XCTUnwrap(object["reasoning"] as? [String: Any])
            XCTAssertEqual(reasoning["effort"] as? String, "low")
            return Self.successResponse(for: request)
        }

        let engine = OpenAIRefinementEngine(
            model: "gpt-5.6-luna",
            reasoningEffort: .low,
            secretStore: InMemorySecretStore(openAIKey: "sk-test"),
            session: session
        )

        _ = try await engine.refine(RefineRequest(raw_transcript: "hello"))
    }

    func testRefineOmitsAbsentReasoningEffort() async throws {
        let session = makeSession()
        OpenAIURLProtocolStub.handler = { request in
            let body = try XCTUnwrap(request.httpBodyData())
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertNil(object["reasoning"])
            return Self.successResponse(for: request)
        }

        let engine = OpenAIRefinementEngine(
            model: "gpt-4.1-mini",
            secretStore: InMemorySecretStore(openAIKey: "sk-test"),
            session: session
        )

        _ = try await engine.refine(RefineRequest(raw_transcript: "hello"))
    }

    private func makeSession() -> URLSession {
        URLProtocol.registerClass(OpenAIURLProtocolStub.self)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OpenAIURLProtocolStub.self]
        return URLSession(configuration: config)
    }

    private static func successResponse(for request: URLRequest) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: nil,
            headerFields: nil
        )!
        return (response, #"{"output_text":"Refined."}"#.data(using: .utf8)!)
    }
}

private extension URLRequest {
    func httpBodyData() -> Data? {
        if let httpBody {
            return httpBody
        }
        guard let stream = httpBodyStream else {
            return nil
        }

        stream.open()
        defer { stream.close() }

        var data = Data()
        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read < 0 {
                return nil
            }
            if read == 0 {
                break
            }
            data.append(buffer, count: read)
        }
        return data
    }
}

private final class OpenAIURLProtocolStub: URLProtocol {
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
