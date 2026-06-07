import XCTest
@testable import DictatorCore

final class APIKeyResolverTests: XCTestCase {
    func testResolveNormalizesFallbackValue() {
        let key = APIKeyResolver.resolve(
            fallback: { "  primary-secret  " }
        )

        XCTAssertEqual(key, "primary-secret")
    }

    func testResolveReturnsNilWhenFallbackEmpty() {
        let key = APIKeyResolver.resolve(
            fallback: { "   " }
        )

        XCTAssertNil(key)
    }

    func testResolveUsesFallbackWhenPrimaryMissing() {
        let key = APIKeyResolver.resolve(
            primary: { nil },
            fallback: { "secrets-file-key" }
        )

        XCTAssertEqual(key, "secrets-file-key")
    }

    func testResolvePrefersPrimaryWhenPresent() {
        let key = APIKeyResolver.resolve(
            primary: { "primary-secret" },
            fallback: {
                XCTFail("Fallback should not run when primary key is present")
                return nil
            }
        )

        XCTAssertEqual(key, "primary-secret")
    }
}
