import DictatorCore
import Foundation
import XCTest

final class MigrationExclusionTests: XCTestCase
{
    private let forbiddenSourcePatterns: [(label: String, pattern: String)] = [
        ("external repo path", "/Users/joyo/dictator"),
        ("legacy app layout", "apps/dictator-main"),
        ("realtime-agent code", "apps/realtime-agent"),
        ("vscode extension code", "apps/vscode-extension"),
        ("app-local runtime config", "Config/runtime-config"),
        ("app-local secrets", "Config/secrets"),
        ("legacy trace log", "/tmp/dictator-trace"),
        ("legacy default port", "8787"),
        ("hardcoded LAN address", "192.168.1.56"),
        ("environment variable config", "ProcessInfo.processInfo.environment")
    ]

    private let trackedFileForbiddenPatterns: [(label: String, pattern: String)] = [
        ("realtime-agent tree", "apps/realtime-agent"),
        ("vscode extension tree", "apps/vscode-extension"),
        ("SwiftPM build output", "/.build/"),
        ("local build directory", "/build/"),
        ("node_modules", "/node_modules/"),
        ("dist output", "/dist/"),
        ("crash log", "crash.log"),
        ("secrets file", "secrets.json"),
        ("dot secrets file", ".secrets.json"),
        ("dot env file", ".env"),
        ("SwiftPM module cache", ".swiftpm-module-cache"),
        ("xctest bundle", ".xctest/"),
        ("swiftmodule artifact", ".swiftmodule"),
        ("app bundle", ".app/"),
        ("appex bundle", ".appex/")
    ]

    func testActiveSourceAndTestsExcludeLegacyPatterns() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot().resolvingSymlinksInPath()
        let scanRoots = [
            repoRoot.appendingPathComponent("projects/dictator/src", isDirectory: true),
            repoRoot.appendingPathComponent("projects/dictator/tests", isDirectory: true)
        ]

        var violations: [String] = []
        for root in scanRoots
        {
            guard let enumerator = FileManager.default.enumerator(
                at: root,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]
            ) else
            {
                continue
            }

            for case let fileURL as URL in enumerator
            {
                guard isScannableFile(fileURL) else { continue }

                let relativePath = fileURL
                    .resolvingSymlinksInPath()
                    .path
                    .replacingOccurrences(of: repoRoot.path + "/", with: "")
                if relativePath == "projects/dictator/tests/DictatorServiceTests/MigrationExclusionTests.swift"
                {
                    continue
                }

                let text = try String(contentsOf: fileURL, encoding: .utf8)

                for entry in forbiddenSourcePatterns
                {
                    guard text.contains(entry.pattern) else { continue }
                    if isAllowedForbiddenPatternOccurrence(
                        pattern: entry.pattern,
                        relativePath: relativePath
                    )
                    {
                        continue
                    }
                    violations.append("\(relativePath): \(entry.label)")
                }

                if text.contains("/v1/transcribe") || text.contains("/v1/refine")
                {
                    if relativePath == "projects/dictator/tests/DictatorServiceTests/DictationHTTPServerTests.swift"
                    {
                        continue
                    }
                    violations.append("\(relativePath): retired public route reference")
                }
            }
        }

        XCTAssertTrue(violations.isEmpty, violations.sorted().joined(separator: "\n"))
    }

    func testTrackedProjectFilesExcludeGeneratedAndExternalArtifacts() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let trackedFiles = try trackedDictatorFiles(repoRoot: repoRoot)
        var violations: [String] = []

        for relativePath in trackedFiles
        {
            for entry in trackedFileForbiddenPatterns
            {
                if relativePath.contains(entry.pattern)
                {
                    violations.append("\(relativePath): \(entry.label)")
                }
            }
        }

        XCTAssertTrue(violations.isEmpty, violations.sorted().joined(separator: "\n"))
    }

    func testGeneratedBuildPathsAreGitIgnored() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let ignoredPaths = [
            "projects/dictator/.build/debug",
            "projects/dictator/.build/xcode",
            "projects/dictator/.swiftpm-module-cache/cache",
            "projects/dictator/src/ios-keyboard/DictatorKeyboardHost/build/Debug-iphonesimulator/example.app",
            "projects/dictator/src/ios-keyboard/DictatorKeyboardHost/build/Debug-iphonesimulator/example.xctest"
        ]

        for relativePath in ignoredPaths
        {
            let absolutePath = repoRoot.appendingPathComponent(relativePath).path
            let isIgnored = try XCTUnwrap(
                shellExitCode(repoRoot: repoRoot, arguments: ["git", "check-ignore", "-q", absolutePath]) == 0,
                "expected git to ignore \(relativePath)"
            )
            XCTAssertTrue(isIgnored)
        }
    }

    private func isScannableFile(_ url: URL) -> Bool
    {
        let ext = url.pathExtension.lowercased()
        return ["swift", "md", "js", "html", "css", "json", "yaml", "yml", "plist"].contains(ext)
    }

    private func isAllowedForbiddenPatternOccurrence(pattern: String, relativePath: String) -> Bool
    {
        if pattern == "8787"
            && relativePath == "projects/dictator/tests/DictatorServiceTests/ServiceEndpointResolverTests.swift"
        {
            return true
        }

        // The smoke-test contract is an env-var signal set by Conductor, distinct
        // from Dictator's file-based runtime config. The single bridge file that
        // reads the process environment for it is sanctioned here.
        if pattern == "ProcessInfo.processInfo.environment"
            && relativePath == "projects/dictator/src/Sources/DictatorCore/SmokeTestMode.swift"
        {
            return true
        }

        if (pattern == "/v1/transcribe" || pattern == "/v1/refine")
            && relativePath == "projects/dictator/tests/DictatorServiceTests/DictationHTTPServerTests.swift"
        {
            return true
        }

        return false
    }

    private func trackedDictatorFiles(repoRoot: URL) throws -> [String]
    {
        let process = Process()
        process.currentDirectoryURL = repoRoot
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["ls-files", "projects/dictator"]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)

        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return output
            .split(separator: "\n")
            .map(String.init)
            .filter { !$0.isEmpty }
    }

    private func shellExitCode(repoRoot: URL, arguments: [String]) -> Int32
    {
        let process = Process()
        process.currentDirectoryURL = repoRoot
        process.executableURL = URL(fileURLWithPath: "/usr/bin/" + arguments[0])
        process.arguments = Array(arguments.dropFirst())
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try? process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }
}
