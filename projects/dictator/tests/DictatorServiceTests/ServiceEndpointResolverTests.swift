import XCTest
@testable import DictatorService

final class ServiceEndpointResolverTests: XCTestCase
{
    private let registryEntry = ServiceRegistryEntry(
        name: "dictator",
        host: "0.0.0.0",
        port: 9003,
        command: "make dictator-run",
        homePath: "/"
    )

    func testDefaultsToRegistryEndpointOnPort9003() {
        let endpoint = ServiceEndpointResolver.resolve(
            registryEntry: registryEntry,
            cliHost: nil,
            cliPort: nil
        )

        XCTAssertEqual(endpoint.host, "0.0.0.0")
        XCTAssertEqual(endpoint.port, 9003)
        XCTAssertFalse(endpoint.usedCLIOverride)
    }

    func testCLIOverrideIsVisible() {
        let endpoint = ServiceEndpointResolver.resolve(
            registryEntry: registryEntry,
            cliHost: "127.0.0.1",
            cliPort: 19003
        )

        XCTAssertEqual(endpoint.host, "127.0.0.1")
        XCTAssertEqual(endpoint.port, 19003)
        XCTAssertTrue(endpoint.usedCLIOverride)
    }

    func testRuntimeConfigServerFieldsDoNotAffectResolver() {
        let endpoint = ServiceEndpointResolver.resolve(
            registryEntry: registryEntry,
            cliHost: nil,
            cliPort: nil
        )

        XCTAssertNotEqual(endpoint.port, 8787)
        XCTAssertNotEqual(endpoint.port, 9999)
    }

    func testDictatorServerDisabledDoesNotChangeRegistryEndpoint() {
        let endpoint = ServiceEndpointResolver.resolve(
            registryEntry: registryEntry,
            cliHost: nil,
            cliPort: nil
        )

        XCTAssertEqual(endpoint.port, 9003)
        XCTAssertFalse(endpoint.usedCLIOverride)
    }

    func testCLIOverrideParserReadsHostAndPortFlags() {
        let overrides = CLIServiceOverridesParser.parse(
            arguments: ["--host", "127.0.0.1", "--port", "19003", "ignored"]
        )

        XCTAssertEqual(overrides.host, "127.0.0.1")
        XCTAssertEqual(overrides.port, 19003)
    }

    func testCLIOverrideParserReadsEqualsForm() {
        let overrides = CLIServiceOverridesParser.parse(
            arguments: ["--host=10.0.0.5", "--port=7777"]
        )

        XCTAssertEqual(overrides.host, "10.0.0.5")
        XCTAssertEqual(overrides.port, 7777)
    }
}
