import XCTest
@testable import DictatorCore

final class RefinementPromptBuilderTests: XCTestCase {
    func testContextBlocksRenderBeforeTranscript() {
        let input = RefinementPromptBuilder.buildInput(
            rawTranscript: "this should mention the nil case",
            optionalContext: [:],
            contextBlocks: [
                RefinementContextBlock(
                    title: "Current hunk",
                    metadata: ["file": "Sources/App.swift", "patchHash": "abc"],
                    body: "@@ -1 +1 @@\n-old\n+new"
                )
            ]
        )

        XCTAssertTrue(input.contains("Context block: Current hunk"))
        XCTAssertTrue(input.contains("file: Sources/App.swift"))
        XCTAssertTrue(input.contains("@@ -1 +1 @@"))
        XCTAssertTrue(input.contains("Transcript:\nthis should mention the nil case"))
    }

    func testNoContextBlocksPreservesSelectedTextMode() {
        let input = RefinementPromptBuilder.buildInput(
            rawTranscript: "make it shorter",
            optionalContext: ["selected_text": "This is too long."],
            contextBlocks: []
        )

        XCTAssertTrue(input.contains("Input text:\nThis is too long."))
        XCTAssertTrue(input.contains("Request:\nmake it shorter"))
    }

    func testContextBlocksDisableSelectedTextMode() {
        let input = RefinementPromptBuilder.buildInput(
            rawTranscript: "review this",
            optionalContext: ["selected_text": "Existing selection"],
            contextBlocks: [
                RefinementContextBlock(title: "Current hunk", body: "diff")
            ]
        )

        XCTAssertFalse(input.contains("Input text:\nExisting selection"))
        XCTAssertTrue(input.contains("Context block: Current hunk"))
    }

    func testInjectableRulesAppendMatchingPromptFileContentsCaseInsensitively() throws {
        let (tempDir, catalog) = try makePromptCatalog(files: [
            "dog_rules.md": "dogs are cool",
            "cat_rules.md": "cats are cool"
        ])
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let prompt = InjectableRulesPromptBuilder.buildSystemPrompt(
            basePrompt: "base prompt",
            rawTranscript: "Tell me about Dogs today.",
            injectableRules: ["dogs": "dog_rules.md", "cats": "cat_rules.md"],
            promptCatalog: catalog
        )

        XCTAssertTrue(prompt.contains("base prompt"))
        XCTAssertTrue(prompt.contains("Source: dog_rules.md"))
        XCTAssertTrue(prompt.contains("dogs are cool"))
        XCTAssertFalse(prompt.contains("cats are cool"))
    }

    func testInjectableRulesAppendMultipleMatchesInStableKeyOrder() throws {
        let (tempDir, catalog) = try makePromptCatalog(files: [
            "b.md": "bee rule",
            "a.md": "ant rule"
        ])
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let prompt = InjectableRulesPromptBuilder.buildSystemPrompt(
            basePrompt: "base prompt",
            rawTranscript: "alpha beta",
            injectableRules: ["beta": "b.md", "alpha": "a.md"],
            promptCatalog: catalog
        )

        let alphaIndex = try XCTUnwrap(prompt.range(of: "ant rule")?.lowerBound)
        let betaIndex = try XCTUnwrap(prompt.range(of: "bee rule")?.lowerBound)
        XCTAssertLessThan(alphaIndex, betaIndex)
    }

    func testInjectableRulesSkipMissingPromptFilesAndPreserveBasePrompt() throws {
        let (tempDir, catalog) = try makePromptCatalog(files: [
            "dog_rules.md": "dogs are cool"
        ])
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let prompt = InjectableRulesPromptBuilder.buildSystemPrompt(
            basePrompt: "base prompt",
            rawTranscript: "dogs and cats",
            injectableRules: ["dogs": "dog_rules.md", "cats": "missing.md"],
            promptCatalog: catalog
        )

        XCTAssertTrue(prompt.contains("base prompt"))
        XCTAssertTrue(prompt.contains("dogs are cool"))
        XCTAssertFalse(prompt.contains("missing.md"))
    }

    func testInjectableRulesWithNoMatchesReturnBasePromptExactly() throws {
        let (tempDir, catalog) = try makePromptCatalog(files: [
            "dog_rules.md": "dogs are cool"
        ])
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let prompt = InjectableRulesPromptBuilder.buildSystemPrompt(
            basePrompt: "base prompt",
            rawTranscript: "birds",
            injectableRules: ["dogs": "dog_rules.md"],
            promptCatalog: catalog
        )

        XCTAssertEqual(prompt, "base prompt")
    }

    private func makePromptCatalog(files: [String: String]) throws -> (URL, SystemPromptCatalog) {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        for (name, body) in files {
            try body.write(to: tempDir.appendingPathComponent(name), atomically: true, encoding: .utf8)
        }
        return (tempDir, SystemPromptCatalog(directoryURL: tempDir))
    }
}
