import XCTest
@testable import DictatorService

final class TraceLoggerTests: XCTestCase
{
    func testConfigureWritesUnderLogsDictatorDirectory() throws
    {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let logDirectory = tempDir.appendingPathComponent("logs/dictator", isDirectory: true).path
        TraceLogger.configure(logDirectoryPath: logDirectory)
        TraceLogger.reset()
        TraceLogger.log("trace logger test message")

        let logFile = tempDir
            .appendingPathComponent("logs/dictator/trace.log", isDirectory: false)

        XCTAssertTrue(FileManager.default.fileExists(atPath: logFile.path))

        let contents = try String(contentsOf: logFile, encoding: .utf8)
        XCTAssertTrue(contents.contains("trace logger test message"))
        XCTAssertFalse(contents.contains("sk-"))
    }

    func testConfigureForRepoRootUsesLogsDictator() throws
    {
        let repoRoot = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        TraceLogger.configureForRepoRoot(repoRoot)
        TraceLogger.reset()
        TraceLogger.log("repo-root trace")

        let logFile = repoRoot
            .appendingPathComponent("logs/dictator/trace.log", isDirectory: false)

        XCTAssertTrue(FileManager.default.fileExists(atPath: logFile.path))
        let contents = try String(contentsOf: logFile, encoding: .utf8)
        XCTAssertTrue(contents.contains("repo-root trace"))
    }

    private func makeTempDir() throws -> URL
    {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
