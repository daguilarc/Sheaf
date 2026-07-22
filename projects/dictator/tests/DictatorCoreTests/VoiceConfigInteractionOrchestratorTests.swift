import Foundation
import XCTest
@testable import DictatorCore

final class VoiceConfigInteractionOrchestratorTests: XCTestCase {
    func testInteractionAppliesValidatedPatch() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("runtime-config.json")

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: fileURL),
            defaultStore: nil
        )

        let orchestrator = VoiceConfigInteractionOrchestrator(
            sttEngine: StubSTTEngine(transcript: "switch to cloud model gpt-4.1-mini"),
            runtimeConfigProvider: provider,
            secretStore: StubSecretStore(),
            decisionEngineFactory: { _ in
                StubDecisionEngine(decision: VoiceConfigDecision(kind: .update, patch: RuntimeConfigPatch(model: "gpt-4.1-mini", useCloud: true)))
            },
            modelAvailabilityChecker: StubModelChecker { requested, _, _ in requested }
        )

        let result = try await orchestrator.interact(
            VoiceConfigInteractionRequest(
                audio_b64: "",
                sample_rate: 16000,
                locale: "en-US",
                session_id: "session"
            )
        )

        XCTAssertEqual(result.decision, "update")
        XCTAssertTrue(result.updated)

        let config = await provider.currentConfiguration()
        XCTAssertEqual(config.provider, .openai)
        XCTAssertEqual(config.openAIModel, "gpt-4.1-mini")

        XCTAssertNil(try RuntimeConfigStore(fileURL: fileURL).load())
    }

    func testInteractionNoChangeDoesNotMutate() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("runtime-config.json")

        let provider = RuntimeConfigProvider(store: RuntimeConfigStore(fileURL: fileURL), defaultStore: nil)
        let before = await provider.currentRuntimeConfig()

        let orchestrator = VoiceConfigInteractionOrchestrator(
            sttEngine: StubSTTEngine(transcript: "what model are you using"),
            runtimeConfigProvider: provider,
            secretStore: StubSecretStore(),
            decisionEngineFactory: { _ in
                StubDecisionEngine(decision: VoiceConfigDecision(kind: .noChange))
            },
            modelAvailabilityChecker: StubModelChecker { requested, _, _ in requested }
        )

        let result = try await orchestrator.interact(
            VoiceConfigInteractionRequest(audio_b64: "", sample_rate: 16000, locale: "en-US", session_id: "session")
        )

        XCTAssertFalse(result.updated)
        XCTAssertEqual(result.decision, "no_change")

        let after = await provider.currentRuntimeConfig()
        XCTAssertEqual(before, after)
    }

    func testInteractionUsesClosestResolvedModel() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("runtime-config.json")

        let provider = RuntimeConfigProvider(store: RuntimeConfigStore(fileURL: fileURL), defaultStore: nil)

        let orchestrator = VoiceConfigInteractionOrchestrator(
            sttEngine: StubSTTEngine(transcript: "switch model to qwen2.5"),
            runtimeConfigProvider: provider,
            secretStore: StubSecretStore(),
            decisionEngineFactory: { _ in
                StubDecisionEngine(decision: VoiceConfigDecision(kind: .update, patch: RuntimeConfigPatch(model: "qwen2.5", useCloud: false)))
            },
            modelAvailabilityChecker: StubModelChecker { _, _, _ in "qwen2.5:7b-instruct" }
        )

        let result = try await orchestrator.interact(
            VoiceConfigInteractionRequest(audio_b64: "", sample_rate: 16000, locale: "en-US", session_id: "session")
        )

        XCTAssertEqual(result.runtime_config.model, "qwen2.5:7b-instruct")
    }

    func testInteractionValidationErrorDoesNotMutateConfig() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("runtime-config.json")

        let provider = RuntimeConfigProvider(store: RuntimeConfigStore(fileURL: fileURL), defaultStore: nil)
        let before = await provider.currentRuntimeConfig()

        let orchestrator = VoiceConfigInteractionOrchestrator(
            sttEngine: StubSTTEngine(transcript: "switch model to missing"),
            runtimeConfigProvider: provider,
            secretStore: StubSecretStore(),
            decisionEngineFactory: { _ in
                StubDecisionEngine(decision: VoiceConfigDecision(kind: .update, patch: RuntimeConfigPatch(model: "missing-model", useCloud: false)))
            },
            modelAvailabilityChecker: StubModelChecker { _, _, _ in
                throw DictatorError.configUpdateFailed("model unavailable")
            }
        )

        do {
            _ = try await orchestrator.interact(
                VoiceConfigInteractionRequest(audio_b64: "", sample_rate: 16000, locale: "en-US", session_id: "session")
            )
            XCTFail("Expected config update failure")
        } catch let error as DictatorError {
            guard case let .configUpdateFailed(reason) = error else {
                return XCTFail("Unexpected DictatorError: \(error)")
            }
            XCTAssertTrue(reason.contains("model unavailable"))
        }

        let after = await provider.currentRuntimeConfig()
        XCTAssertEqual(before, after)
    }

    private func makeTempDir() throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

private struct StubDecisionEngine: VoiceConfigDecisionEngine {
    let decision: VoiceConfigDecision

    func decide(transcript: String, current: RuntimeConfigFile) async throws -> VoiceConfigDecision {
        decision
    }
}

private struct StubSTTEngine: STTEngine {
    let transcript: String

    func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse {
        TranscribeResponse(raw_transcript: transcript, segments: [], confidence: 1.0, duration_ms: 100)
    }
}

private struct StubSecretStore: SecretStore {
    func getOpenAIKey() throws -> String? { nil }
    func setOpenAIKey(_ key: String) throws {}
    func clearOpenAIKey() throws {}
}

private struct StubModelChecker: ModelAvailabilityChecking {
    let resolver: @Sendable (String, Bool, LLMRuntimeConfiguration) throws -> String

    init(resolver: @escaping @Sendable (String, Bool, LLMRuntimeConfiguration) throws -> String) {
        self.resolver = resolver
    }

    func resolveModel(requestedModel: String, useCloud: Bool, configuration: LLMRuntimeConfiguration) async throws -> String {
        try resolver(requestedModel, useCloud, configuration)
    }
}
