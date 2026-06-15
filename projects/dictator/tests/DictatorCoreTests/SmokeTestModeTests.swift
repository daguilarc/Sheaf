import XCTest
@testable import DictatorCore

final class SmokeTestModeTests: XCTestCase {
    private let repoRoot = URL(fileURLWithPath: "/repo/worktree", isDirectory: true)

    func testIsActiveParsesTruthyValues() {
        XCTAssertTrue(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "1"]))
        XCTAssertTrue(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "true"]))
        XCTAssertTrue(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "TRUE"]))
        XCTAssertTrue(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "yes"]))
    }

    func testIsActiveParsesFalsyValues() {
        XCTAssertFalse(SmokeTestMode.isActive(environment: [:]))
        XCTAssertFalse(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": ""]))
        XCTAssertFalse(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "   "]))
        XCTAssertFalse(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "0"]))
        XCTAssertFalse(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "false"]))
        XCTAssertFalse(SmokeTestMode.isActive(environment: ["SHEAF_SMOKE_TEST_MODE": "False"]))
    }

    func testResolveAssetRootReturnsRepoRootWhenSmokeOff() {
        let resolved = SmokeTestMode.resolveAssetRoot(
            repoRoot: repoRoot,
            environment: ["SHEAF_SMOKE_ASSET_ROOT": "/main/checkout"],
            directoryExists: { _ in true }
        )

        XCTAssertEqual(resolved.url, repoRoot)
        XCTAssertFalse(resolved.usedSmokeAssetRoot)
        XCTAssertNil(resolved.warning)
    }

    func testResolveAssetRootUsesSmokeAssetRootWhenValid() {
        let resolved = SmokeTestMode.resolveAssetRoot(
            repoRoot: repoRoot,
            environment: [
                "SHEAF_SMOKE_TEST_MODE": "1",
                "SHEAF_SMOKE_ASSET_ROOT": "/main/checkout",
            ],
            directoryExists: { $0 == "/main/checkout" }
        )

        XCTAssertEqual(resolved.url, URL(fileURLWithPath: "/main/checkout", isDirectory: true))
        XCTAssertTrue(resolved.usedSmokeAssetRoot)
        XCTAssertNil(resolved.warning)
    }

    func testResolveAssetRootFallsBackWhenAssetRootUnset() {
        let resolved = SmokeTestMode.resolveAssetRoot(
            repoRoot: repoRoot,
            environment: ["SHEAF_SMOKE_TEST_MODE": "1"],
            directoryExists: { _ in true }
        )

        XCTAssertEqual(resolved.url, repoRoot)
        XCTAssertFalse(resolved.usedSmokeAssetRoot)
        XCTAssertNotNil(resolved.warning)
    }

    func testResolveAssetRootFallsBackWhenAssetRootMissing() {
        let resolved = SmokeTestMode.resolveAssetRoot(
            repoRoot: repoRoot,
            environment: [
                "SHEAF_SMOKE_TEST_MODE": "1",
                "SHEAF_SMOKE_ASSET_ROOT": "/does/not/exist",
            ],
            directoryExists: { _ in false }
        )

        XCTAssertEqual(resolved.url, repoRoot)
        XCTAssertFalse(resolved.usedSmokeAssetRoot)
        XCTAssertNotNil(resolved.warning)
    }
}
