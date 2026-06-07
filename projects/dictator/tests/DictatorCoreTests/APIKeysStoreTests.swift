import XCTest
@testable import DictatorCore

final class APIKeysStoreTests: XCTestCase
{
    func testLoadMissingFileReturnsNilKey() throws
    {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let store = APIKeysStore(fileURL: tempDir.appendingPathComponent("api_keys.json"))
        XCTAssertNil(try store.getOpenAIKey())
    }

    func testLoadEmptyPlaceholderReturnsNilKey() throws
    {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("api_keys.json")
        try """
        {"openai_api_key":"   "}
        """.write(to: fileURL, atomically: true, encoding: .utf8)

        let store = APIKeysStore(fileURL: fileURL)
        XCTAssertNil(try store.getOpenAIKey())
    }

    func testLoadReturnsTrimmedKey() throws
    {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("api_keys.json")
        try """
        {"openai_api_key":"  sk-test-key  ","omlx_api_key":"shared-test-key"}
        """.write(to: fileURL, atomically: true, encoding: .utf8)

        let store = APIKeysStore(fileURL: fileURL)
        XCTAssertEqual(try store.getOpenAIKey(), "sk-test-key")
    }

    func testLoadInvalidJSONThrowsConfigError() throws
    {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let fileURL = tempDir.appendingPathComponent("api_keys.json")
        try "not-json".write(to: fileURL, atomically: true, encoding: .utf8)

        let store = APIKeysStore(fileURL: fileURL)
        XCTAssertThrowsError(try store.getOpenAIKey())
        { error in
            guard case let DictatorError.configUpdateFailed(reason) = error else
            {
                return XCTFail("unexpected error: \(error)")
            }
            XCTAssertTrue(reason.contains("invalid API keys file"))
            XCTAssertFalse(reason.contains("sk-"))
        }
    }

    func testWriteOperationsAreRejected() throws
    {
        let tempDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tempDir) }
        let store = APIKeysStore(fileURL: tempDir.appendingPathComponent("api_keys.json"))

        XCTAssertThrowsError(try store.setOpenAIKey("secret"))
        XCTAssertThrowsError(try store.clearOpenAIKey())
    }

    private func makeTempDir() throws -> URL
    {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
