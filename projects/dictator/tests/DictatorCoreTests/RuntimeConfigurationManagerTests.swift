import Foundation
import XCTest
@testable import DictatorCore

final class RuntimeConfigurationManagerTests: XCTestCase {
    override func tearDown() {
        URLProtocol.unregisterClass(RuntimeConfigurationURLProtocolStub.self)
        super.tearDown()
    }

    func testListUsesOllamaTagsEndpointForModelOptions() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: tempDir.appendingPathComponent("runtime-config.json")),
            defaultStore: nil
        )
        let session = makeSession()
        RuntimeConfigurationURLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:11434/api/tags")
            let data = #"{"models":[{"name":"qwen2.5:7b-instruct"},{"name":"llama3.2"}]}"#.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }

        let manager = RuntimeConfigurationManager(
            configurations: [
                RuntimeModelConfiguration(
                    name: "Local Model",
                    currentValue: "qwen2.5:7b-instruct",
                    defaultValue: "qwen2.5:7b-instruct",
                    target: .local,
                    optionsSource: .ollama,
                    runtimeConfigProvider: provider,
                    host: "http://127.0.0.1:11434",
                    session: session
                ),
                RuntimeBooleanConfiguration(
                    name: "Use Cloud",
                    currentValue: false,
                    defaultValue: false,
                    runtimeConfigProvider: provider
                )
            ]
        )

        let listed = try await manager.list()
        let model = try XCTUnwrap(listed.first(where: { $0.name == "Local Model" }))
        XCTAssertTrue(model.options.isEmpty)

        let options = try await manager.getOptions(name: "Local Model")
        XCTAssertEqual(options, [.string("qwen2.5:7b-instruct"), .string("llama3.2")])
    }

    func testResetToDefaultsUpdatesRuntimeConfigInMemory() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let fileURL = tempDir.appendingPathComponent("runtime-config.json")
        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: fileURL),
            defaultStore: nil
        )

        _ = try await provider.applyInMemoryPatch(
            RuntimeConfigPatch(model: "llama3.2", useCloud: true)
        )

        let manager = RuntimeConfigurationManager(
            configurations: [
                RuntimeModelConfiguration(
                    name: "Local Model",
                    currentValue: "llama3.2",
                    defaultValue: "qwen2.5:7b-instruct",
                    target: .local,
                    optionsSource: .ollama,
                    runtimeConfigProvider: provider,
                    host: "http://127.0.0.1:11434",
                    session: makeStaticModelSession(models: ["qwen2.5:7b-instruct", "llama3.2"])
                ),
                RuntimeBooleanConfiguration(
                    name: "Use Cloud",
                    currentValue: true,
                    defaultValue: false,
                    runtimeConfigProvider: provider
                )
            ]
        )

        try await manager.resetToDefaults()

        let inMemory = await provider.currentRuntimeConfig()
        XCTAssertEqual(inMemory.model, "qwen2.5:7b-instruct")
        XCTAssertFalse(inMemory.useCloud)
    }

    func testSystemPromptConfigurationUsesPromptDirectoryFiles() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let promptsDir = tempDir.appendingPathComponent("prompts/system-prompts", isDirectory: true)
        try FileManager.default.createDirectory(at: promptsDir, withIntermediateDirectories: true)
        try "v1".write(to: promptsDir.appendingPathComponent("intent_refiner_v1.md"), atomically: true, encoding: .utf8)
        let nestedDir = promptsDir.appendingPathComponent("team/release", isDirectory: true)
        try FileManager.default.createDirectory(at: nestedDir, withIntermediateDirectories: true)
        try "v2".write(to: nestedDir.appendingPathComponent("intent_refiner_v2.md"), atomically: true, encoding: .utf8)

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: tempDir.appendingPathComponent("runtime-config.json")),
            defaultStore: nil
        )

        let manager = RuntimeConfigurationManager(
            configurations: [
                RuntimeSystemPromptConfiguration(
                    name: "System Prompt",
                    currentValue: "intent_refiner_v1.md",
                    defaultValue: "intent_refiner_v1.md",
                    runtimeConfigProvider: provider,
                    promptCatalog: SystemPromptCatalog(directoryURL: promptsDir)
                )
            ]
        )

        let options = try await manager.getOptions(name: "System Prompt")
        XCTAssertEqual(options, [.string("intent_refiner_v1.md"), .string("team/release/intent_refiner_v2.md")])

        try await manager.set(name: "System Prompt", value: .string("team/release/intent_refiner_v2.md"))
        let inMemory = await provider.currentRuntimeConfig()
        XCTAssertEqual(inMemory.systemPrompt, "team/release/intent_refiner_v2.md")
    }

    func testAuxiliarySystemPromptConfigurationUpdatesAuxiliaryPromptPath() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let promptsDir = tempDir.appendingPathComponent("prompts/system-prompts", isDirectory: true)
        try FileManager.default.createDirectory(at: promptsDir, withIntermediateDirectories: true)
        try "aux".write(to: promptsDir.appendingPathComponent("auxiliary_refiner_1.md"), atomically: true, encoding: .utf8)

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: tempDir.appendingPathComponent("runtime-config.json")),
            defaultStore: nil
        )

        let manager = RuntimeConfigurationManager(
            configurations: [
                RuntimeSystemPromptConfiguration(
                    name: "Auxiliary Prompt 1",
                    currentValue: "intent_refiner_v1.md",
                    defaultValue: "intent_refiner_v1.md",
                    runtimeConfigProvider: provider,
                    target: .auxiliary1,
                    promptCatalog: SystemPromptCatalog(directoryURL: promptsDir)
                )
            ]
        )

        try await manager.set(name: "Auxiliary Prompt 1", value: .string("auxiliary_refiner_1.md"))
        let inMemory = await provider.currentRuntimeConfig()
        XCTAssertEqual(inMemory.auxiliarySystemPrompt1, "auxiliary_refiner_1.md")
    }

    func testReviewSystemPromptConfigurationUpdatesReviewPromptPath() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let promptsDir = tempDir.appendingPathComponent("prompts/system-prompts", isDirectory: true)
        try FileManager.default.createDirectory(at: promptsDir, withIntermediateDirectories: true)
        try "review".write(to: promptsDir.appendingPathComponent("code_review_refiner_v1.md"), atomically: true, encoding: .utf8)

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: tempDir.appendingPathComponent("runtime-config.json")),
            defaultStore: nil
        )

        let manager = RuntimeConfigurationManager(
            configurations: [
                RuntimeSystemPromptConfiguration(
                    name: "Review Prompt",
                    currentValue: SystemPromptCatalog.defaultReviewPromptFile,
                    defaultValue: SystemPromptCatalog.defaultReviewPromptFile,
                    runtimeConfigProvider: provider,
                    target: .review,
                    promptCatalog: SystemPromptCatalog(directoryURL: promptsDir)
                )
            ]
        )

        let options = try await manager.getOptions(name: "Review Prompt")
        XCTAssertEqual(options, [.string("code_review_refiner_v1.md")])

        try await manager.set(name: "Review Prompt", value: .string("code_review_refiner_v1.md"))
        let inMemory = await provider.currentRuntimeConfig()
        XCTAssertEqual(inMemory.reviewSystemPrompt, "code_review_refiner_v1.md")
    }

    func testInteractionsBufferConfigurationUpdatesRuntimeConfig() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: tempDir.appendingPathComponent("runtime-config.json")),
            defaultStore: nil
        )

        let manager = RuntimeConfigurationManager(
            configurations: [
                RuntimeInteractionsBufferConfiguration(
                    name: "Interactions Buffer",
                    currentValueBytes: 100 * 1024 * 1024,
                    defaultValueBytes: 100 * 1024 * 1024,
                    runtimeConfigProvider: provider
                )
            ]
        )

        let options = try await manager.getOptions(name: "Interactions Buffer")
        XCTAssertEqual(options, [.string("25 MB"), .string("50 MB"), .string("100 MB"), .string("200 MB"), .string("500 MB")])

        try await manager.set(name: "Interactions Buffer", value: .string("50 MB"))
        let inMemory = await provider.currentRuntimeConfig()
        XCTAssertEqual(inMemory.interactionsBufferBytes, 50 * 1024 * 1024)
    }

    private func makeTempDir() throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func makeSession() -> URLSession {
        URLProtocol.registerClass(RuntimeConfigurationURLProtocolStub.self)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RuntimeConfigurationURLProtocolStub.self]
        return URLSession(configuration: config)
    }

    private func makeStaticModelSession(models: [String]) -> URLSession {
        URLProtocol.registerClass(RuntimeConfigurationURLProtocolStub.self)
        RuntimeConfigurationURLProtocolStub.handler = { request in
            let modelsJSON = models.map { #"{"name":"\#($0)"}"# }.joined(separator: ",")
            let payload = #"{"models":[\#(modelsJSON)]}"#
            let data = payload.data(using: .utf8)!
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RuntimeConfigurationURLProtocolStub.self]
        return URLSession(configuration: config)
    }
}

private final class RuntimeConfigurationURLProtocolStub: URLProtocol {
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
