import XCTest
@testable import DictatorCore

final class SheafRuntimePathsTests: XCTestCase
{
    func testBootstrapDefaultsUseSheafPaths() {
        let bootstrap = RuntimeConfigFile.bootstrap()

        XCTAssertEqual(bootstrap.dataDir, "data/dictator")
        XCTAssertEqual(bootstrap.systemPromptsDir, "projects/dictator/src/prompts/system-prompts")
        XCTAssertEqual(bootstrap.dictatorServerPort, 9003)
        XCTAssertTrue(bootstrap.dictatorServerEnabled)
    }

    func testDefaultConfigFileURLPointsAtConfigDictatorJSON() throws
    {
        let repoRoot = try makeSheafRepoRoot()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        let nested = repoRoot.appendingPathComponent("projects/dictator", isDirectory: true)
        let fileURL = RuntimeConfigStore.defaultFileURL(currentDirectoryPath: nested.path)

        XCTAssertEqual(
            fileURL.standardizedFileURL.path,
            repoRoot.appendingPathComponent("config/dictator.json").standardizedFileURL.path
        )
    }

    func testResolvedDataDirectoryUsesRepoRootForDataDictatorPath() throws
    {
        let repoRoot = try makeSheafRepoRoot()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        let runtime = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: false,
            dataDir: "data/dictator",
            updatedAt: "2026-06-07T00:00:00Z"
        )

        let nested = repoRoot.appendingPathComponent("projects/dictator", isDirectory: true).path
        let resolved = runtime.resolvedDataDirectoryURL(currentDirectoryPath: nested)

        XCTAssertEqual(
            resolved.standardizedFileURL.path,
            repoRoot.appendingPathComponent("data/dictator", isDirectory: true).standardizedFileURL.path
        )
    }

    func testResolvedSystemPromptsDirectoryUsesRepoRootPath() throws
    {
        let repoRoot = try makeSheafRepoRoot()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        let promptsDir = repoRoot.appendingPathComponent(
            "projects/dictator/src/prompts/system-prompts",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: promptsDir, withIntermediateDirectories: true)

        let runtime = RuntimeConfigFile(
            version: 2,
            cloudModel: "gpt-4.1-mini",
            localModel: "qwen2.5:7b-instruct",
            useCloud: false,
            systemPromptsDir: "projects/dictator/src/prompts/system-prompts",
            updatedAt: "2026-06-07T00:00:00Z"
        )

        let nested = repoRoot.appendingPathComponent("projects/dictator", isDirectory: true).path
        let resolved = runtime.resolvedSystemPromptsDirectoryURL(currentDirectoryPath: nested)

        XCTAssertEqual(resolved.standardizedFileURL.path, promptsDir.standardizedFileURL.path)
    }

    private func makeSheafRepoRoot() throws -> URL
    {
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

    private func makeTempDir() throws -> URL
    {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
