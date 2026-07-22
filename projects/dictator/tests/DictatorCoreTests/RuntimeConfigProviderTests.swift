import Foundation
import XCTest
@testable import DictatorCore

final class RuntimeConfigProviderTests: XCTestCase {
    func testRuntimeConfigDrivesEffectiveConfiguration() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let fileURL = tempDir.appendingPathComponent("runtime-config.json")
        let seed = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1",
            localModel: "qwen2.5:7b-instruct",
            useCloud: true,
            fallbackMode: "none",
            ollamaHost: "http://localhost:11434/",
            updatedAt: "2026-02-23T00:00:00Z"
        )
        try RuntimeConfigStore(fileURL: fileURL).save(seed)

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: fileURL),
            defaultStore: nil
        )

        let config = await provider.currentConfiguration()
        XCTAssertEqual(config.provider, .openai)
        XCTAssertEqual(config.openAIModel, "gpt-4.1")
        XCTAssertEqual(config.ollamaModel, "qwen2.5:7b-instruct")
        XCTAssertEqual(config.fallback, .none)
        XCTAssertEqual(config.ollamaHost, "http://localhost:11434")
    }

    func testApplyPatchPersistsAndImmediatelyAffectsEffectiveConfig() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let fileURL = tempDir.appendingPathComponent("runtime-config.json")
        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: fileURL),
            defaultStore: nil
        )

        _ = try await provider.applyPatch(RuntimeConfigPatch(model: "gpt-4.1-mini", useCloud: true))

        let config = await provider.currentConfiguration()
        XCTAssertEqual(config.provider, .openai)
        XCTAssertEqual(config.openAIModel, "gpt-4.1-mini")

        let persisted = try XCTUnwrap(try RuntimeConfigStore(fileURL: fileURL).load())
        XCTAssertEqual(persisted.model, "gpt-4.1-mini")
        XCTAssertTrue(persisted.useCloud)
    }

    func testLoadFromStoreIntoMemoryDoesNotOverwritePrimaryFile() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let safeURL = tempDir.appendingPathComponent("runtime-config.safe")

        let primary = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4o-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: true,
            updatedAt: "2026-02-24T00:00:00Z"
        )
        let safe = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: false,
            updatedAt: "2026-02-24T00:05:00Z"
        )

        let primaryStore = RuntimeConfigStore(fileURL: primaryURL)
        let safeStore = RuntimeConfigStore(fileURL: safeURL)
        try primaryStore.save(primary)
        try safeStore.save(safe)

        let provider = RuntimeConfigProvider(store: primaryStore, defaultStore: nil)
        let loaded = try await provider.loadFromStoreIntoMemory(safeStore)
        XCTAssertEqual(loaded, safe)

        let inMemory = await provider.currentRuntimeConfig()
        XCTAssertEqual(inMemory, safe)

        let primaryPersisted = try XCTUnwrap(try primaryStore.load())
        XCTAssertEqual(primaryPersisted, primary)
    }

    func testStartupDefaultsComeFromSafeStoreWhenPrimaryMissing() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let safeURL = tempDir.appendingPathComponent("runtime-config.safe")

        let safe = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: false,
            updatedAt: "2026-02-24T00:05:00Z"
        )
        try RuntimeConfigStore(fileURL: safeURL).save(safe)

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: primaryURL),
            defaultStore: RuntimeConfigStore(fileURL: safeURL)
        )

        let startupDefault = await provider.startupDefaultConfig()
        XCTAssertEqual(startupDefault, safe)

        let current = await provider.currentRuntimeConfig()
        XCTAssertEqual(current, safe)
    }

    func testExampleBackedStartupDoesNotCreatePrimaryFileUntilMutation() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let exampleURL = tempDir.appendingPathComponent("runtime-config.example.json")

        let example = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-5.6-luna",
            localModel: "qwen2.5:7b-instruct",
            useCloud: true,
            launchpadModels: [.proMk3, .miniMk3],
            updatedAt: "2026-07-22T00:00:00Z"
        )
        try RuntimeConfigStore(fileURL: exampleURL).save(example)

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: primaryURL),
            defaultStore: RuntimeConfigStore(fileURL: exampleURL)
        )

        let current = await provider.currentRuntimeConfig()
        XCTAssertEqual(current, example)
        XCTAssertFalse(FileManager.default.fileExists(atPath: primaryURL.path))

        let updated = try await provider.applyPatch(RuntimeConfigPatch(systemPrompt: "conservative.md"))

        XCTAssertEqual(updated.launchpadModels, [.proMk3, .miniMk3])
        let persisted = try XCTUnwrap(try RuntimeConfigStore(fileURL: primaryURL).load())
        XCTAssertEqual(persisted.systemPrompt, "conservative.md")
        XCTAssertEqual(persisted.launchpadModels, [.proMk3, .miniMk3])
    }

    func testApplyInMemoryPatchDoesNotPersistToPrimaryFile() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let primary = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: true,
            updatedAt: "2026-02-24T00:00:00Z"
        )
        let primaryStore = RuntimeConfigStore(fileURL: primaryURL)
        try primaryStore.save(primary)

        let provider = RuntimeConfigProvider(store: primaryStore, defaultStore: nil)
        let updated = try await provider.applyInMemoryPatch(RuntimeConfigPatch(model: "qwen2.5:7b-instruct", useCloud: false))
        XCTAssertEqual(updated.model, "qwen2.5:7b-instruct")
        XCTAssertFalse(updated.useCloud)
        XCTAssertEqual(updated.localModel, "qwen2.5:7b-instruct")
        XCTAssertEqual(updated.cloudModel, "gpt-4.1-mini")

        let inMemory = await provider.currentRuntimeConfig()
        XCTAssertEqual(inMemory.model, "qwen2.5:7b-instruct")
        XCTAssertFalse(inMemory.useCloud)

        let persisted = try XCTUnwrap(try primaryStore.load())
        XCTAssertEqual(persisted, primary)
    }

    func testRuntimeConfigDefaultsInteractionsBufferToOneHundredMBWhenMissing() throws {
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-4.1-mini",
          "local_model": "qwen2.5:7b-instruct",
          "system_prompt": "intent_refiner_v1.md",
          "use_cloud": false,
          "updated_at": "2026-02-24T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(RuntimeConfigFile.self, from: json)
        XCTAssertEqual(decoded.interactionsBufferBytes, RuntimeConfigFile.defaultInteractionsBufferBytes)
        XCTAssertEqual(decoded.ollamaHost, RuntimeConfigFile.defaultOllamaHost)
        XCTAssertEqual(decoded.sttModelPath, RuntimeConfigFile.defaultSTTModelPath)
        XCTAssertEqual(decoded.auxiliarySystemPrompt1, SystemPromptCatalog.defaultPromptFile)
        XCTAssertEqual(decoded.auxiliarySystemPrompt2, SystemPromptCatalog.defaultPromptFile)
        XCTAssertEqual(decoded.dictatorServerHost, RuntimeConfigFile.defaultDictatorServerHost)
        XCTAssertEqual(decoded.dictatorServerPort, RuntimeConfigFile.defaultDictatorServerPort)
        XCTAssertEqual(decoded.dictatorServerEnabled, RuntimeConfigFile.defaultDictatorServerEnabled)
        XCTAssertEqual(decoded.injectableRules, [:])
        XCTAssertNil(decoded.reasoningEffort)
    }

    func testRuntimeConfigDecodesAndEncodesReasoningEffort() throws {
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-5.6-luna",
          "local_model": "qwen2.5:7b-instruct",
          "reasoning_effort": "low",
          "use_cloud": true,
          "updated_at": "2026-07-13T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(RuntimeConfigFile.self, from: json)
        XCTAssertEqual(decoded.reasoningEffort, .low)

        let encoded = try JSONEncoder().encode(decoded)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(object["reasoning_effort"] as? String, "low")
    }

    func testRuntimeConfigRejectsUnsupportedReasoningEffort() throws {
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-5.6-luna",
          "local_model": "qwen2.5:7b-instruct",
          "reasoning_effort": "ultra",
          "use_cloud": true,
          "updated_at": "2026-07-13T00:00:00Z"
        }
        """.data(using: .utf8)!

        XCTAssertThrowsError(try JSONDecoder().decode(RuntimeConfigFile.self, from: json))
    }

    func testRuntimeConfigLaunchpadModelsDefaultToProThenMiniWhenMissing() throws {
        let decoded = try decodeRuntimeConfigJSON(audioInputLine: nil)

        XCTAssertEqual(decoded.launchpadModels, [.proMk3, .miniMk3])
    }

    func testRuntimeConfigDecodesAndEncodesLaunchpadModelPreferences() throws {
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-5.6-luna",
          "local_model": "qwen2.5:7b-instruct",
          "launchpad_models": ["mini_mk3", "pro_mk3"],
          "use_cloud": true,
          "updated_at": "2026-07-22T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(RuntimeConfigFile.self, from: json)
        XCTAssertEqual(decoded.launchpadModels, [.miniMk3, .proMk3])

        let encoded = try JSONEncoder().encode(decoded)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(object["launchpad_models"] as? [String], ["mini_mk3", "pro_mk3"])
        XCTAssertNil(object["launchpad_model"])
    }

    func testRuntimeConfigAcceptsLegacyLaunchpadModelScalarAsSinglePreference() throws {
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-5.6-luna",
          "local_model": "qwen2.5:7b-instruct",
          "launchpad_model": "mini_mk3",
          "use_cloud": true,
          "updated_at": "2026-07-22T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(RuntimeConfigFile.self, from: json)
        XCTAssertEqual(decoded.launchpadModels, [.miniMk3])
    }

    func testRuntimeConfigRejectsInvalidLaunchpadModelPreferences() throws {
        for launchpadLine in [
            #""launchpad_models": [],"#,
            #""launchpad_models": ["pro_mk3", "pro_mk3"],"#,
            #""launchpad_models": ["launchpad_x"],"#
        ] {
            let json = """
            {
              "version": 2,
              "cloud_model": "gpt-5.6-luna",
              "local_model": "qwen2.5:7b-instruct",
              \(launchpadLine)
              "use_cloud": true,
              "updated_at": "2026-07-22T00:00:00Z"
            }
            """.data(using: .utf8)!

            XCTAssertThrowsError(try JSONDecoder().decode(RuntimeConfigFile.self, from: json))
        }
    }

    func testUnrelatedPatchPreservesLaunchpadModelPreferences() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let fileURL = tempDir.appendingPathComponent("runtime-config.json")
        let seed = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-5.6-luna",
            localModel: "qwen2.5:7b-instruct",
            useCloud: true,
            launchpadModels: [.miniMk3, .proMk3],
            updatedAt: "2026-07-22T00:00:00Z"
        )
        let store = RuntimeConfigStore(fileURL: fileURL)
        try store.save(seed)
        let provider = RuntimeConfigProvider(store: store, defaultStore: nil)

        let updated = try await provider.applyPatch(RuntimeConfigPatch(systemPrompt: "conservative.md"))

        XCTAssertEqual(updated.launchpadModels, [.miniMk3, .proMk3])
        XCTAssertEqual(try store.load()?.launchpadModels, [.miniMk3, .proMk3])
    }

    func testUnrelatedPatchPreservesReasoningEffort() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let fileURL = tempDir.appendingPathComponent("runtime-config.json")
        let seed = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-5.6-luna",
            localModel: "qwen2.5:7b-instruct",
            reasoningEffort: .low,
            useCloud: true,
            updatedAt: "2026-07-13T00:00:00Z"
        )
        let store = RuntimeConfigStore(fileURL: fileURL)
        try store.save(seed)
        let provider = RuntimeConfigProvider(store: store, defaultStore: nil)

        let updated = try await provider.applyPatch(RuntimeConfigPatch(systemPrompt: "conservative.md"))

        XCTAssertEqual(updated.reasoningEffort, .low)
        XCTAssertEqual(try store.load()?.reasoningEffort, .low)
    }

    func testRuntimeConfigAudioInputDefaultsToNilWhenMissingNullOrBlank() throws {
        XCTAssertNil(RuntimeConfigFile.bootstrap(now: Date(timeIntervalSince1970: 0)).audioInput)

        let missing = try decodeRuntimeConfigJSON(audioInputLine: nil)
        XCTAssertNil(missing.audioInput)

        let explicitNull = try decodeRuntimeConfigJSON(audioInputLine: #""audio_input": null,"#)
        XCTAssertNil(explicitNull.audioInput)

        let blank = try decodeRuntimeConfigJSON(audioInputLine: #""audio_input": "   ","#)
        XCTAssertNil(blank.audioInput)
    }

    func testRuntimeConfigAudioInputStoresTrimmedNonBlankAndEncodesIt() throws {
        let decoded = try decodeRuntimeConfigJSON(audioInputLine: #""audio_input": "  Scarlett 2i2  ","#)
        XCTAssertEqual(decoded.audioInput, "Scarlett 2i2")

        let encoded = try JSONEncoder().encode(decoded)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(object["audio_input"] as? String, "Scarlett 2i2")
    }

    func testRuntimeConfigAudioInputAcceptsCamelCaseAlias() throws {
        let named = try decodeRuntimeConfigJSON(audioInputLine: #""audioInput": "  Scarlett 2i2  ","#)
        XCTAssertEqual(named.audioInput, "Scarlett 2i2")

        let explicitNull = try decodeRuntimeConfigJSON(audioInputLine: #""audioInput": null,"#)
        XCTAssertNil(explicitNull.audioInput)

        let blank = try decodeRuntimeConfigJSON(audioInputLine: #""audioInput": "   ","#)
        XCTAssertNil(blank.audioInput)
    }

    func testRuntimeConfigAudioInputNilIsOmittedWhenEncoded() throws {
        let decoded = try decodeRuntimeConfigJSON(audioInputLine: #""audio_input": null,"#)

        let encoded = try JSONEncoder().encode(decoded)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertNil(object["audio_input"])
    }

    func testAudioInputPatchPersistsTrimmedNamedSelectorAndCanReturnToDefault() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: primaryURL),
            defaultStore: nil
        )

        var updated = try await provider.applyPatch(
            RuntimeConfigPatch(audioInput: "  Scarlett 2i2  ")
        )
        XCTAssertEqual(updated.audioInput, "Scarlett 2i2")

        var persisted = try XCTUnwrap(try RuntimeConfigStore(fileURL: primaryURL).load())
        XCTAssertEqual(persisted.audioInput, "Scarlett 2i2")

        updated = try await provider.applyPatch(
            RuntimeConfigPatch(audioInput: .some(nil))
        )
        XCTAssertNil(updated.audioInput)

        persisted = try XCTUnwrap(try RuntimeConfigStore(fileURL: primaryURL).load())
        XCTAssertNil(persisted.audioInput)
    }

    func testRestoreDefaultsToDiskRestoresSafeAudioInputDefault() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let safeURL = tempDir.appendingPathComponent("runtime-config.safe")

        let safe = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            audioInput: nil,
            useCloud: false,
            updatedAt: "2026-02-24T00:05:00Z"
        )
        let primary = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            audioInput: "Scarlett 2i2",
            useCloud: false,
            updatedAt: "2026-02-24T00:00:00Z"
        )
        try RuntimeConfigStore(fileURL: safeURL).save(safe)
        try RuntimeConfigStore(fileURL: primaryURL).save(primary)

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: primaryURL),
            defaultStore: RuntimeConfigStore(fileURL: safeURL)
        )

        let startupDefault = await provider.startupDefaultConfig()
        XCTAssertNil(startupDefault.audioInput)

        let restored = try await provider.restoreDefaultsToDisk(now: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(restored.audioInput, startupDefault.audioInput)

        let persisted = try XCTUnwrap(try RuntimeConfigStore(fileURL: primaryURL).load())
        XCTAssertEqual(persisted.audioInput, startupDefault.audioInput)
    }

    func testRuntimeConfigDecodesAndPersistsInjectableRules() throws {
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-4.1-mini",
          "local_model": "qwen2.5:7b-instruct",
          "system_prompt": "intent_refiner_v1.md",
          "use_cloud": false,
          "review_system_prompt": "code_review_refiner_v1.md",
          "injectable_rules": {
            " dogs ": " dog_rules.md ",
            "cats": "cat_rules.md"
          },
          "updated_at": "2026-02-24T00:00:00Z"
        }
        """.data(using: .utf8)!

        // A stale `review_system_prompt` key from older configs must be ignored, not fatal.
        let decoded = try JSONDecoder().decode(RuntimeConfigFile.self, from: json)
        XCTAssertEqual(decoded.injectableRules, [
            "dogs": "dog_rules.md",
            "cats": "cat_rules.md"
        ])

        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let store = RuntimeConfigStore(fileURL: tempDir.appendingPathComponent("dictator.json"))
        try store.save(decoded)

        let persisted = try XCTUnwrap(try store.load())
        XCTAssertEqual(persisted.injectableRules["dogs"], "dog_rules.md")
        XCTAssertEqual(persisted.injectableRules["cats"], "cat_rules.md")
    }

    func testApplyInMemoryPatchUpdatesAuxiliaryPromptPaths() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let primaryStore = RuntimeConfigStore(fileURL: primaryURL)
        let provider = RuntimeConfigProvider(store: primaryStore, defaultStore: nil)

        let updated = try await provider.applyInMemoryPatch(
            RuntimeConfigPatch(
                auxiliarySystemPrompt1: "aux/one.md",
                auxiliarySystemPrompt2: "aux/two.md"
            )
        )

        XCTAssertEqual(updated.auxiliarySystemPrompt1, "aux/one.md")
        XCTAssertEqual(updated.auxiliarySystemPrompt2, "aux/two.md")
    }

    func testRuntimeConfigDecodesDictatorServerOverrides() throws {
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-4.1-mini",
          "local_model": "qwen2.5:7b-instruct",
          "system_prompt": "intent_refiner_v1.md",
          "use_cloud": false,
          "dictator_server_host": "127.0.0.1",
          "dictator_server_port": 9999,
          "dictator_server_enabled": false,
          "updated_at": "2026-02-24T00:00:00Z"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(RuntimeConfigFile.self, from: json)
        XCTAssertEqual(decoded.dictatorServerHost, "127.0.0.1")
        XCTAssertEqual(decoded.dictatorServerPort, 9999)
        XCTAssertFalse(decoded.dictatorServerEnabled)
    }

    func testApplyInMemoryPatchUpdatesInteractionsBufferBytes() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let primaryStore = RuntimeConfigStore(fileURL: primaryURL)
        let provider = RuntimeConfigProvider(store: primaryStore, defaultStore: nil)

        let updated = try await provider.applyInMemoryPatch(
            RuntimeConfigPatch(interactionsBufferBytes: 25 * 1024 * 1024)
        )

        XCTAssertEqual(updated.interactionsBufferBytes, 25 * 1024 * 1024)
    }

    func testApplyPatchUpsertsAndDeletesInjectableRules() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: primaryURL),
            defaultStore: nil
        )

        var updated = try await provider.applyPatch(
            RuntimeConfigPatch(
                injectableRuleUpsert: InjectableRuleUpsert(
                    key: " dogs ",
                    promptPath: " dog_rules.md "
                )
            )
        )
        XCTAssertEqual(updated.injectableRules, ["dogs": "dog_rules.md"])

        updated = try await provider.applyPatch(
            RuntimeConfigPatch(
                injectableRuleUpsert: InjectableRuleUpsert(
                    key: "dogs",
                    promptPath: "better_dog_rules.md"
                )
            )
        )
        XCTAssertEqual(updated.injectableRules, ["dogs": "better_dog_rules.md"])

        updated = try await provider.applyPatch(RuntimeConfigPatch(injectableRuleDeleteKey: "dogs"))
        XCTAssertEqual(updated.injectableRules, [:])
    }

    func testApplyPatchRejectsInvalidInjectableRuleEdits() async throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let primaryURL = tempDir.appendingPathComponent("runtime-config.json")
        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: primaryURL),
            defaultStore: nil
        )

        try await assertInjectableRulePatchFails(provider, RuntimeConfigPatch(
            injectableRuleUpsert: InjectableRuleUpsert(key: " ", promptPath: "dog_rules.md")
        ))
        try await assertInjectableRulePatchFails(provider, RuntimeConfigPatch(
            injectableRuleUpsert: InjectableRuleUpsert(key: "dogs", promptPath: " ")
        ))
        try await assertInjectableRulePatchFails(provider, RuntimeConfigPatch(
            injectableRuleUpsert: InjectableRuleUpsert(key: "dogs", promptPath: "/tmp/dog_rules.md")
        ))
        try await assertInjectableRulePatchFails(provider, RuntimeConfigPatch(
            injectableRuleUpsert: InjectableRuleUpsert(key: "dogs", promptPath: "../dog_rules.md")
        ))

        let current = await provider.currentRuntimeConfig()
        XCTAssertEqual(current.injectableRules, [:])
    }

    private func makeSheafRepoRoot() throws -> URL {
        let repoRoot = try makeTempDir()
        try FileManager.default.createDirectory(
            at: repoRoot.appendingPathComponent("config", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: repoRoot.appendingPathComponent("projects/dictator", isDirectory: true),
            withIntermediateDirectories: true
        )
        try """
        []
        """.write(
            to: repoRoot.appendingPathComponent("config/services.json"),
            atomically: true,
            encoding: .utf8
        )
        return repoRoot
    }

    private func makeTempDir() throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func decodeRuntimeConfigJSON(audioInputLine: String?) throws -> RuntimeConfigFile {
        let audioInput = audioInputLine.map { "\n          \($0)" } ?? ""
        let json = """
        {
          "version": 2,
          "cloud_model": "gpt-4.1-mini",
          "local_model": "qwen2.5:7b-instruct",\(audioInput)
          "system_prompt": "intent_refiner_v1.md",
          "use_cloud": false,
          "updated_at": "2026-02-24T00:00:00Z"
        }
        """.data(using: .utf8)!
        return try JSONDecoder().decode(RuntimeConfigFile.self, from: json)
    }

    private func assertInjectableRulePatchFails(
        _ provider: RuntimeConfigProvider,
        _ patch: RuntimeConfigPatch
    ) async throws {
        do {
            _ = try await provider.applyPatch(patch)
            XCTFail("Expected injectable rule patch to fail")
        } catch let error as DictatorError {
            guard case .configUpdateFailed = error else {
                return XCTFail("Unexpected DictatorError: \(error)")
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
