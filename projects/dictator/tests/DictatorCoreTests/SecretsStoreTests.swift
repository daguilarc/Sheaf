import XCTest
@testable import DictatorCore

final class SecretsStoreTests: XCTestCase {
    func testLoadMissingFileReturnsNilKey() throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let store = SecretsStore(fileURL: tempDir.appendingPathComponent("secrets.json"))
        XCTAssertNil(try store.getOpenAIKey())
    }

    func testLoadEmptyPlaceholderReturnsNilKey() throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("secrets.json")
        try """
        {"openai_api_key":"   "}
        """.write(to: fileURL, atomically: true, encoding: .utf8)

        let store = SecretsStore(fileURL: fileURL)
        XCTAssertNil(try store.getOpenAIKey())
    }

    func testLoadReturnsTrimmedKey() throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("secrets.json")
        try """
        {"openai_api_key":"  sk-test-key  "}
        """.write(to: fileURL, atomically: true, encoding: .utf8)

        let store = SecretsStore(fileURL: fileURL)
        XCTAssertEqual(try store.getOpenAIKey(), "sk-test-key")
    }

    func testLoadInvalidJSONThrowsConfigError() throws {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("secrets.json")
        try "not-json".write(to: fileURL, atomically: true, encoding: .utf8)

        let store = SecretsStore(fileURL: fileURL)
        XCTAssertThrowsError(try store.getOpenAIKey()) { error in
            guard case let DictatorError.configUpdateFailed(reason) = error else {
                return XCTFail("unexpected error: \(error)")
            }
            XCTAssertTrue(reason.contains("invalid secrets file"))
        }
    }

    private func makeTempDir() throws -> URL {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
