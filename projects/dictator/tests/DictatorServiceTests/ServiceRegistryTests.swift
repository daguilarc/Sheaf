import XCTest
@testable import DictatorService

final class ServiceRegistryTests: XCTestCase
{
    func testLoadReturnsDictatorEntry() throws
    {
        let repoRoot = try makeSheafRepoRoot()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        try writeServices(
            at: repoRoot,
            json: """
            [
              {
                "name": "dictator",
                "host": "0.0.0.0",
                "port": 9003,
                "home_path": "/",
                "command": "make dictator-run"
              }
            ]
            """
        )

        let entry = try ServiceRegistry.load(repoRoot: repoRoot, serviceName: "dictator")
        XCTAssertEqual(entry.name, "dictator")
        XCTAssertEqual(entry.host, "0.0.0.0")
        XCTAssertEqual(entry.port, 9003)
        XCTAssertEqual(entry.command, "make dictator-run")
        XCTAssertEqual(entry.homePath, "/")
    }

    func testMissingServiceProducesClearError() throws
    {
        let repoRoot = try makeSheafRepoRoot()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        try writeServices(at: repoRoot, json: "[]")

        XCTAssertThrowsError(try ServiceRegistry.load(repoRoot: repoRoot, serviceName: "dictator"))
        { error in
            XCTAssertEqual(error as? ServiceRegistry.RegistryError, .serviceNotFound(name: "dictator"))
        }
    }

    func testMissingServicesFileProducesClearError() throws
    {
        let repoRoot = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: repoRoot) }

        XCTAssertThrowsError(try ServiceRegistry.load(repoRoot: repoRoot, serviceName: "dictator"))
        { error in
            guard case let ServiceRegistry.RegistryError.servicesFileMissing(path) = error else
            {
                return XCTFail("unexpected error: \(error)")
            }
            XCTAssertTrue(path.hasSuffix("config/services.json"))
        }
    }

    private func makeSheafRepoRoot() throws -> URL
    {
        let repoRoot = try makeTempDir()
        try FileManager.default.createDirectory(
            at: repoRoot.appendingPathComponent("config", isDirectory: true),
            withIntermediateDirectories: true
        )
        return repoRoot
    }

    private func writeServices(at repoRoot: URL, json: String) throws
    {
        try json.write(
            to: repoRoot.appendingPathComponent("config/services.json"),
            atomically: true,
            encoding: .utf8
        )
    }

    private func makeTempDir() throws -> URL
    {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
