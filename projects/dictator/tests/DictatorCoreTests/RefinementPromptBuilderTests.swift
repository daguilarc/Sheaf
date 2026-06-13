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
}
