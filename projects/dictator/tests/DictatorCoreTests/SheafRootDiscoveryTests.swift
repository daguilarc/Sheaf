import XCTest
@testable import DictatorCore

final class SheafRootDiscoveryTests: XCTestCase
{
    func testFindRepoRootFromNestedDirectory() throws
    {
        let repoRoot = try makeSheafRepoRoot()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        let nested = repoRoot.appendingPathComponent("projects/dictator/src", isDirectory: true)
        let found = SheafRootDiscovery.findRepoRoot(startingAt: nested)

        XCTAssertEqual(found?.standardizedFileURL.path, repoRoot.standardizedFileURL.path)
    }

    func testRequireRepoRootThrowsWhenMissingMarkers() throws
    {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        XCTAssertThrowsError(try SheafRootDiscovery.requireRepoRoot(startingAt: tempDir))
        { error in
            guard case let SheafRootDiscovery.DiscoveryError.repoRootNotFound(startingPath) = error else
            {
                return XCTFail("unexpected error: \(error)")
            }
            XCTAssertEqual(startingPath, tempDir.standardizedFileURL.path)
        }
    }

    func testIsSheafRepoRootRequiresServicesAndDictatorProject() throws
    {
        let repoRoot = try makeSheafRepoRoot()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        XCTAssertTrue(SheafRootDiscovery.isSheafRepoRoot(repoRoot))

        let missingProject = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: missingProject) }
        try FileManager.default.createDirectory(
            at: missingProject.appendingPathComponent("config", isDirectory: true),
            withIntermediateDirectories: true
        )
        try """
        []
        """.write(
            to: missingProject.appendingPathComponent("config/services.json"),
            atomically: true,
            encoding: .utf8
        )

        XCTAssertFalse(SheafRootDiscovery.isSheafRepoRoot(missingProject))
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
