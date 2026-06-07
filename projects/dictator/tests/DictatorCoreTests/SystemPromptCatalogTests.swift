import Foundation
import XCTest
@testable import DictatorCore

final class SystemPromptCatalogTests: XCTestCase {
    func testLoadPromptReturnsNestedFileContents() throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let nestedDir = tempDir.appendingPathComponent("team/release", isDirectory: true)
        try FileManager.default.createDirectory(at: nestedDir, withIntermediateDirectories: true)
        let promptFile = nestedDir.appendingPathComponent("intent_v2.md")
        try "hello from nested".write(to: promptFile, atomically: true, encoding: .utf8)

        let catalog = SystemPromptCatalog(directoryURL: tempDir)
        XCTAssertEqual(try catalog.loadPrompt(named: "team/release/intent_v2.md"), "hello from nested")
    }

    func testListPromptFilesReturnsRecursiveRelativePaths() throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        try "root".write(to: tempDir.appendingPathComponent("root.md"), atomically: true, encoding: .utf8)
        let nestedDir = tempDir.appendingPathComponent("alpha/beta", isDirectory: true)
        try FileManager.default.createDirectory(at: nestedDir, withIntermediateDirectories: true)
        try "nested".write(to: nestedDir.appendingPathComponent("nested.md"), atomically: true, encoding: .utf8)

        let catalog = SystemPromptCatalog(directoryURL: tempDir)
        XCTAssertEqual(try catalog.listPromptFiles(), ["alpha/beta/nested.md", "root.md"])
    }

    func testListEntriesReturnsDirectoriesThenFilesForDirectory() throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let alpha = tempDir.appendingPathComponent("alpha", isDirectory: true)
        try FileManager.default.createDirectory(at: alpha, withIntermediateDirectories: true)
        try "a".write(to: tempDir.appendingPathComponent("zeta.md"), atomically: true, encoding: .utf8)

        let catalog = SystemPromptCatalog(directoryURL: tempDir)
        let entries = try catalog.listEntries(in: "")

        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0], .init(name: "alpha", relativePath: "alpha", kind: .directory))
        XCTAssertEqual(entries[1], .init(name: "zeta.md", relativePath: "zeta.md", kind: .file))
    }

    func testResolvePromptFallsBackWhenFileMissing() {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let catalog = SystemPromptCatalog(directoryURL: tempDir)

        let resolved = catalog.resolvePrompt(named: "missing/path.md")
        XCTAssertEqual(resolved, RefinementPromptBuilder.fallbackInstructions)
    }

    func testSanitizeRelativePathStripsTraversalAndDefaultsOnInvalid() {
        let catalog = SystemPromptCatalog(directoryURL: URL(fileURLWithPath: "/tmp"))

        XCTAssertEqual(catalog.sanitizeRelativePath("team/release/prompt.md"), "team/release/prompt.md")
        XCTAssertEqual(catalog.sanitizeRelativePath("./team/../team/release/prompt.md"), "team/release/prompt.md")
        XCTAssertEqual(catalog.sanitizeRelativePath("../../escape.md"), SystemPromptCatalog.defaultPromptFile)
        XCTAssertEqual(catalog.sanitizeRelativePath(""), SystemPromptCatalog.defaultPromptFile)
    }

    private func makeTempDir() throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
