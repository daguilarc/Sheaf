import Foundation
import XCTest
@testable import DictatorCore

final class OllamaRefinementEngineTests: XCTestCase {
    override func tearDown() {
        URLProtocol.unregisterClass(OllamaURLProtocolStub.self)
        super.tearDown()
    }

    func testRefineSuccessReturnsTrimmedResponse() async throws {
        let session = makeSession()
        OllamaURLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:11434/api/generate")
            let body = try XCTUnwrap(request.httpBodyData())
            let decoded = try JSONDecoder().decode(TestPayload.self, from: body)
            XCTAssertEqual(decoded.model, "qwen2.5:7b-instruct")
            XCTAssertFalse(decoded.stream)
            XCTAssertFalse(decoded.prompt.isEmpty)
            XCTAssertFalse(decoded.system.isEmpty)

            let data = #"{"response":"  Hello world.  "}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }

        let engine = OllamaRefinementEngine(
            host: "http://127.0.0.1:11434",
            model: "qwen2.5:7b-instruct",
            session: session
        )
        let output = try await engine.refine(RefineRequest(raw_transcript: "hello world"))

        XCTAssertEqual(output.revised_text, "Hello world.")
        XCTAssertEqual(output.edit_summary, "Refined with Ollama model.")
    }

    func testRefineThrowsOnEmptyResponse() async {
        let session = makeSession()
        OllamaURLProtocolStub.handler = { request in
            let data = #"{"response":"   "}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }

        let engine = OllamaRefinementEngine(session: session)

        do {
            _ = try await engine.refine(RefineRequest(raw_transcript: "hello"))
            XCTFail("Expected refinement failure")
        } catch let error as DictatorError {
            guard case let .refinementFailed(reason) = error else {
                return XCTFail("Unexpected DictatorError: \(error)")
            }
            XCTAssertTrue(reason.contains("did not include output text"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testRefineMapsNetworkFailure() async {
        let session = makeSession()
        OllamaURLProtocolStub.handler = { _ in
            throw URLError(.cannotConnectToHost)
        }

        let engine = OllamaRefinementEngine(session: session)

        do {
            _ = try await engine.refine(RefineRequest(raw_transcript: "hello"))
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
        URLProtocol.registerClass(OllamaURLProtocolStub.self)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OllamaURLProtocolStub.self]
        return URLSession(configuration: config)
    }
}

private struct TestPayload: Decodable {
    let model: String
    let prompt: String
    let system: String
    let stream: Bool
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

private final class OllamaURLProtocolStub: URLProtocol {
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
