import XCTest
@testable import DictatorCore

final class RefinementProviderRoutingTests: XCTestCase {
    func testOllamaPrimarySuccessSkipsOpenAIFallback() async throws {
        let ollama = StubRefinementEngine(result: .success(.init(revised_text: "local", edit_summary: "ollama", uncertainty_flags: [])))
        let openAI = StubRefinementEngine(result: .success(.init(revised_text: "remote", edit_summary: "openai", uncertainty_flags: [])))
        let engine = ProviderRoutingRefinementEngine(
            configuration: .init(
                provider: .ollama,
                ollamaHost: "http://127.0.0.1:11434",
                ollamaModel: "qwen2.5:7b-instruct",
                fallback: .openai,
                openAIModel: "gpt-4.1-mini"
            ),
            ollamaEngine: ollama,
            openAIEngine: openAI,
            canUseOpenAI: { true }
        )

        let output = try await engine.refine(.init(raw_transcript: "hello"))
        let ollamaCalls = await ollama.calls()
        let openAICalls = await openAI.calls()

        XCTAssertEqual(output.revised_text, "local")
        XCTAssertEqual(ollamaCalls, 1)
        XCTAssertEqual(openAICalls, 0)
    }

    func testOllamaFailureFallsBackToOpenAIWhenConfiguredAndKeyExists() async throws {
        let ollama = StubRefinementEngine(result: .failure(DictatorError.networkUnavailable))
        let openAI = StubRefinementEngine(result: .success(.init(revised_text: "remote", edit_summary: "openai", uncertainty_flags: [])))
        let engine = ProviderRoutingRefinementEngine(
            configuration: .init(
                provider: .ollama,
                ollamaHost: "http://127.0.0.1:11434",
                ollamaModel: "qwen2.5:7b-instruct",
                fallback: .openai,
                openAIModel: "gpt-4.1-mini"
            ),
            ollamaEngine: ollama,
            openAIEngine: openAI,
            canUseOpenAI: { true }
        )

        let output = try await engine.refine(.init(raw_transcript: "hello"))
        let openAICalls = await openAI.calls()

        XCTAssertEqual(output.revised_text, "remote")
        XCTAssertEqual(openAICalls, 1)
    }

    func testOllamaFailureDoesNotFallbackWithoutOpenAIKey() async {
        let ollama = StubRefinementEngine(result: .failure(DictatorError.networkUnavailable))
        let openAI = StubRefinementEngine(result: .success(.init(revised_text: "remote", edit_summary: "openai", uncertainty_flags: [])))
        let engine = ProviderRoutingRefinementEngine(
            configuration: .init(
                provider: .ollama,
                ollamaHost: "http://127.0.0.1:11434",
                ollamaModel: "qwen2.5:7b-instruct",
                fallback: .openai,
                openAIModel: "gpt-4.1-mini"
            ),
            ollamaEngine: ollama,
            openAIEngine: openAI,
            canUseOpenAI: { false }
        )

        do {
            _ = try await engine.refine(.init(raw_transcript: "hello"))
            XCTFail("Expected primary error")
        } catch let error as DictatorError {
            guard case .networkUnavailable = error else {
                return XCTFail("Unexpected DictatorError: \(error)")
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        let openAICalls = await openAI.calls()
        XCTAssertEqual(openAICalls, 0)
    }

    func testOpenAIPrimaryPathBypassesOllama() async throws {
        let ollama = StubRefinementEngine(result: .success(.init(revised_text: "local", edit_summary: "ollama", uncertainty_flags: [])))
        let openAI = StubRefinementEngine(result: .success(.init(revised_text: "remote", edit_summary: "openai", uncertainty_flags: [])))
        let engine = ProviderRoutingRefinementEngine(
            configuration: .init(
                provider: .openai,
                ollamaHost: "http://127.0.0.1:11434",
                ollamaModel: "qwen2.5:7b-instruct",
                fallback: .none,
                openAIModel: "gpt-4.1-mini"
            ),
            ollamaEngine: ollama,
            openAIEngine: openAI,
            canUseOpenAI: { false }
        )

        let output = try await engine.refine(.init(raw_transcript: "hello"))
        let ollamaCalls = await ollama.calls()
        let openAICalls = await openAI.calls()

        XCTAssertEqual(output.revised_text, "remote")
        XCTAssertEqual(ollamaCalls, 0)
        XCTAssertEqual(openAICalls, 1)
    }
}

private actor StubRefinementEngine: RefinementEngine {
    let result: Result<RefineResponse, Error>
    private var callCount: Int = 0

    init(result: Result<RefineResponse, Error>) {
        self.result = result
    }

    func refine(_ request: RefineRequest) async throws -> RefineResponse {
        callCount += 1
        return try result.get()
    }

    func calls() -> Int {
        callCount
    }
}
