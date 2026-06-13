import XCTest
@testable import DictatorService

final class DiffReviewStoreTests: XCTestCase {
    func testReviewEntriesSerializeInOrderAndOmitAcceptedHunks() {
        let store = DiffReviewStore()
        let first = hunk(id: "h1", hash: "aaa")
        let second = hunk(id: "h2", hash: "bbb")

        store.appendComment(hunk: first, text: "Please simplify this branch.")
        store.appendReverted(hunk: second)

        let serialized = store.serializedReview()
        XCTAssertNotNil(serialized)
        XCTAssertTrue(serialized?.contains("1. Sources/App.swift @@ -1 +1 @@ [aaa]") == true)
        XCTAssertTrue(serialized?.contains("Please simplify this branch.") == true)
        XCTAssertTrue(serialized?.contains("diff --git a/Sources/App.swift b/Sources/App.swift") == true)
        XCTAssertTrue(serialized?.contains("-old\n+new") == true)
        XCTAssertTrue(serialized?.contains("2. Sources/App.swift @@ -1 +1 @@ [bbb]") == true)
        XCTAssertTrue(serialized?.contains("Rejected this hunk. Do not reintroduce it in the next turn.") == true)
        XCTAssertTrue(serialized?.contains("```diff") == true)
    }

    func testUndoRevertRemovesMatchingMarker() {
        let store = DiffReviewStore()
        let first = hunk(id: "h1", hash: "aaa")
        let second = hunk(id: "h2", hash: "bbb")

        store.appendReverted(hunk: first)
        store.appendReverted(hunk: second)
        store.removeReverted(hunk: second)

        let serialized = store.serializedReview()
        XCTAssertTrue(serialized?.contains("[aaa]") == true)
        XCTAssertFalse(serialized?.contains("[bbb]") == true)
        XCTAssertEqual(store.entryCount, 1)
    }

    func testPostErrorPreservesReviewUntilSuccessfulClear() {
        let store = DiffReviewStore()
        store.appendComment(hunk: hunk(id: "h1", hash: "aaa"), text: "Keep this note.")

        store.recordPostError("clipboard restore failed")
        XCTAssertTrue(store.hasActiveReview)
        XCTAssertEqual(store.diagnostics().lastPostError, "clipboard restore failed")

        store.clearAfterSuccessfulPost()
        XCTAssertFalse(store.hasActiveReview)
        XCTAssertNil(store.serializedReview())
    }

    private func hunk(id: String, hash: String) -> VSCodeHunkReviewContext {
        VSCodeHunkReviewContext(
            repoRoot: "/repo",
            file: "Sources/App.swift",
            hunkId: id,
            hunkIndex: 0,
            hunkCount: 1,
            header: "@@ -1 +1 @@",
            patchHash: hash,
            patch: "diff --git a/Sources/App.swift b/Sources/App.swift\n@@ -1 +1 @@\n-old\n+new\n"
        )
    }
}
