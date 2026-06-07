import XCTest
@testable import DictatorService
@testable import DictatorCore

final class OllamaBootstrapperTests: XCTestCase {
    func testShouldAttemptAutoStartWhenProviderIsOllamaAndHostIsLocal() {
        let config = LLMRuntimeConfiguration(
            provider: .ollama,
            ollamaHost: "http://127.0.0.1:11434",
            ollamaModel: "qwen2.5:7b-instruct",
            fallback: .openai,
            openAIModel: "gpt-4.1-mini"
        )

        XCTAssertTrue(OllamaBootstrapper.shouldAttemptAutoStart(configuration: config))
    }

    func testShouldNotAttemptAutoStartWhenProviderIsOpenAI() {
        let config = LLMRuntimeConfiguration(
            provider: .openai,
            ollamaHost: "http://127.0.0.1:11434",
            ollamaModel: "qwen2.5:7b-instruct",
            fallback: .none,
            openAIModel: "gpt-4.1-mini"
        )

        XCTAssertFalse(OllamaBootstrapper.shouldAttemptAutoStart(configuration: config))
    }

    func testShouldNotAttemptAutoStartForNonLocalHost() {
        let config = LLMRuntimeConfiguration(
            provider: .ollama,
            ollamaHost: "http://10.0.0.7:11434",
            ollamaModel: "qwen2.5:7b-instruct",
            fallback: .none,
            openAIModel: "gpt-4.1-mini"
        )

        XCTAssertFalse(OllamaBootstrapper.shouldAttemptAutoStart(configuration: config))
    }

    func testLoopbackHostDetection() {
        XCTAssertTrue(OllamaBootstrapper.isLoopbackHost("http://localhost:11434"))
        XCTAssertTrue(OllamaBootstrapper.isLoopbackHost("http://127.0.0.1:11434"))
        XCTAssertFalse(OllamaBootstrapper.isLoopbackHost("http://ollama.internal:11434"))
    }
}
