import XCTest
@testable import DictatorCore

final class TalonLiteGrammarParserTests: XCTestCase {
    func testParsesCharacterSequence() throws {
        let ast = try TalonLiteGrammarParser.parse("air bat cap")
        XCTAssertEqual(ast.expressions.count, 3)
    }

    func testParsesUnaryWordOperator() throws {
        let ast = try TalonLiteGrammarParser.parse("word hello")
        XCTAssertEqual(ast.expressions, [.operatorCall(.unaryIdentifier(op: "word", identifier: "hello"))])
    }

    func testParsesUnaryShiftOperator() throws {
        let ast = try TalonLiteGrammarParser.parse("shift air")
        XCTAssertEqual(ast.expressions, [.operatorCall(.unaryCharacter(op: "shift", character: "air"))])
    }

    func testParsesNaryIdentifierWithBlarkTerminator() throws {
        let ast = try TalonLiteGrammarParser.parse("hammer yes no blark")
        XCTAssertEqual(ast.expressions, [.operatorCall(.naryIdentifier(op: "hammer", identifiers: ["yes", "no"]))])
    }

    func testParsesMultiWordOperator() throws {
        let ast = try TalonLiteGrammarParser.parse("dub string hello world blark")
        XCTAssertEqual(ast.expressions, [.operatorCall(.naryIdentifier(op: "dub string", identifiers: ["hello", "world"]))])
    }

    func testRejectsInvalidTopLevelIdentifierToken() {
        XCTAssertThrowsError(try TalonLiteGrammarParser.parse("hello")) { error in
            guard case let TalonLiteGrammarParseError.invalidToken(token) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertEqual(token, "hello")
        }
    }

    func testBinaryOperatorsNeverMatch() {
        XCTAssertThrowsError(try TalonLiteGrammarParser.parse("foo bar"))
    }
}
