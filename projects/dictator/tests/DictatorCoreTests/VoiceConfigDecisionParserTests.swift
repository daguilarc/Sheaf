import XCTest
@testable import DictatorCore

final class VoiceConfigDecisionParserTests: XCTestCase {
    func testParseUpdateDecision() throws {
        let payload = #"{"decision":"update","update":{"model":"gpt-4.1-mini","use_cloud":true}}"#
        let parsed = try VoiceConfigDecisionParser.parse(payload)

        XCTAssertEqual(parsed.kind, .update)
        XCTAssertEqual(parsed.patch?.model, "gpt-4.1-mini")
        XCTAssertEqual(parsed.patch?.useCloud, true)
    }

    func testParseNoChangeDecision() throws {
        let payload = #"{"decision":"no_change"}"#
        let parsed = try VoiceConfigDecisionParser.parse(payload)

        XCTAssertEqual(parsed.kind, .noChange)
        XCTAssertNil(parsed.patch)
    }

    func testRejectsUnsupportedUpdateKeys() {
        let payload = #"{"decision":"update","update":{"model":"x","use_cloud":false,"provider":"openai"}}"#

        XCTAssertThrowsError(try VoiceConfigDecisionParser.parse(payload)) { error in
            guard case let DictatorError.configUpdateFailed(reason) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertTrue(reason.contains("unsupported keys"))
        }
    }
}
