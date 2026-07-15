import XCTest
@testable import DictatorCore

final class LLMRuntimeConfigurationTests: XCTestCase {
    func testFromRuntimeConfigUsesDefaults() {
        let runtime = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: false,
            updatedAt: "2026-03-03T00:00:00Z"
        )

        let config = LLMRuntimeConfiguration.fromRuntimeConfig(runtime)
        XCTAssertEqual(config.provider, .ollama)
        XCTAssertEqual(config.ollamaHost, RuntimeConfigFile.defaultOllamaHost)
        XCTAssertEqual(config.ollamaModel, "qwen2.5:7b-instruct")
        XCTAssertEqual(config.fallback, .openai)
        XCTAssertEqual(config.openAIModel, "gpt-4.1-mini")
        XCTAssertEqual(config.systemPrompt, "intent_refiner_v1.md")
        XCTAssertEqual(config.ollamaBinPath, RuntimeConfigFile.defaultOllamaBinPath)
    }

    func testFromRuntimeConfigMapsCloudModeAndFallback() {
        let runtime = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1",
            localModel: "qwen2.5-coder:7b",
            reasoningEffort: .low,
            useCloud: true,
            fallbackMode: "none",
            ollamaHost: "http://localhost:11434/",
            ollamaBinPath: "/tmp/ollama",
            updatedAt: "2026-03-03T00:00:00Z"
        )

        let config = LLMRuntimeConfiguration.fromRuntimeConfig(runtime)
        XCTAssertEqual(config.provider, .openai)
        XCTAssertEqual(config.ollamaHost, "http://localhost:11434")
        XCTAssertEqual(config.ollamaModel, "qwen2.5-coder:7b")
        XCTAssertEqual(config.fallback, .none)
        XCTAssertEqual(config.openAIModel, "gpt-4.1")
        XCTAssertEqual(config.reasoningEffort, .low)
        XCTAssertEqual(config.ollamaBinPath, "/tmp/ollama")
    }

    func testFromRuntimeConfigPreservesAbsentReasoningEffort() {
        let runtime = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: true,
            updatedAt: "2026-03-03T00:00:00Z"
        )

        let config = LLMRuntimeConfiguration.fromRuntimeConfig(runtime)
        XCTAssertNil(config.reasoningEffort)
    }
}
