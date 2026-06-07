import XCTest
@testable import DictatorCore

final class TalonLiteRendererTests: XCTestCase {
    func testRendersNestedBraceClosuresWithBlark() throws {
        let ast = try TalonLiteGrammarParser.parse("paren angle blark blark")
        let rendered = try TalonLiteRenderer.render(ast)
        XCTAssertEqual(rendered, "(<>)")
    }

    func testTopLevelBlarkOnEmptyStackFails() {
        XCTAssertThrowsError(try TalonLiteRenderer.render(TalonLiteAST(expressions: [.bang]))) { error in
            guard case let DictatorError.talonPipelineFailed(reason) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertTrue(reason.contains("empty brace stack"))
        }
    }

    func testShiftUppercasesLettersOnly() throws {
        let ast = try TalonLiteGrammarParser.parse("shift air shift dot")
        let rendered = try TalonLiteRenderer.render(ast)
        XCTAssertEqual(rendered, "A.")
    }

    func testWordOperatorInsertsIdentifier() throws {
        let ast = try TalonLiteGrammarParser.parse("word hello")
        let rendered = try TalonLiteRenderer.render(ast)
        XCTAssertEqual(rendered, "hello")
    }

    func testHammerFormatsAsPublicCamelCase() throws {
        let ast = try TalonLiteGrammarParser.parse("hammer yes no blark")
        let rendered = try TalonLiteRenderer.render(ast)
        XCTAssertEqual(rendered, "YesNo")
    }
}
