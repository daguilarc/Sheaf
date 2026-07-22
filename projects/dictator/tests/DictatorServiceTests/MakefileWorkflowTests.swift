import DictatorCore
import Foundation
import XCTest

final class MakefileWorkflowTests: XCTestCase
{
    func testDefaultDictatorBuildAndTestDoNotDependOnIOSLanes() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let makefile = try loadMakefile(
            repoRoot.appendingPathComponent("projects/dictator/Makefile")
        )

        XCTAssertEqual(targetDependencies("build", in: makefile), ["swift-build"])
        XCTAssertEqual(targetDependencies("test", in: makefile), ["swift-test"])
        XCTAssertFalse(targetDependencies("build", in: makefile).contains("ios-build"))
        XCTAssertFalse(targetDependencies("test", in: makefile).contains("ios-test"))
    }

    func testIOSBuildAndTestRemainExplicitOptInTargets() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let makefile = try loadMakefile(
            repoRoot.appendingPathComponent("projects/dictator/Makefile")
        )

        XCTAssertTrue(makefile.contains("\nios-build:\n\txcodebuild -project $(IOS_XCODEPROJ)"))
        XCTAssertTrue(makefile.contains("\nios-test:\n\txcodebuild -project $(IOS_XCODEPROJ)"))
        XCTAssertTrue(makefile.contains("IOS_XCODEPROJ := src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj"))
        XCTAssertTrue(makefile.contains("IOS_SCHEME := DictatorKeyboardHost"))
    }

    func testRootDictatorShortcutsDelegateToProjectDefaults() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let makefile = try loadMakefile(repoRoot.appendingPathComponent("Makefile"))

        XCTAssertEqual(targetRecipe("dictator-build", in: makefile), ["$(MAKE) -C projects/dictator build"])
        XCTAssertEqual(targetRecipe("dictator-test", in: makefile), ["$(MAKE) -C projects/dictator test"])
        XCTAssertEqual(
            targetRecipe("dictator-install-talon-bridge", in: makefile),
            ["$(MAKE) -C projects/dictator install-talon-bridge"]
        )
    }

    func testTalonBridgeInstallTargetCreatesRepoSymlinkAndRefusesReplacement() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let makefile = try loadMakefile(
            repoRoot.appendingPathComponent("projects/dictator/Makefile")
        )

        XCTAssertTrue(makefile.contains("TALON_HOME ?= $(HOME)/.talon"))
        XCTAssertTrue(makefile.contains("TALON_BRIDGE_SOURCE := $(abspath src/talon/sheaf_control)"))
        XCTAssertTrue(makefile.contains("TALON_BRIDGE_TARGET := $(TALON_HOME)/user/sheaf_control"))
        XCTAssertTrue(makefile.contains("install-talon-bridge:"))
        XCTAssertTrue(makefile.contains("mkdir -p \"$(TALON_HOME)/user\""))
        XCTAssertTrue(makefile.contains("ln -s \"$(TALON_BRIDGE_SOURCE)\" \"$(TALON_BRIDGE_TARGET)\""))
        XCTAssertTrue(makefile.contains("Refusing to replace existing symlink"))
        XCTAssertTrue(makefile.contains("Refusing to replace existing path"))
    }

    func testDictatorPackageDiscoversWhisperAndGGMLThroughStableHomebrewPrefixes() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let package = try loadMakefile(
            repoRoot.appendingPathComponent("projects/dictator/Package.swift")
        )

        XCTAssertFalse(package.contains("/Cellar/"), "Package.swift must not name version-specific Homebrew Cellar paths")
        XCTAssertTrue(package.contains("/opt/homebrew/opt/whisper-cpp/libexec/lib"))
        XCTAssertTrue(package.contains("/opt/homebrew/opt/whisper-cpp/lib"))
        XCTAssertTrue(package.contains("/opt/homebrew/opt/ggml/lib"))
        XCTAssertTrue(package.contains("/opt/homebrew/opt/whisper-cpp/libexec/include"))
        XCTAssertTrue(package.contains("/opt/homebrew/opt/whisper-cpp/include"))
        XCTAssertTrue(package.contains("/opt/homebrew/opt/ggml/include"))
        XCTAssertTrue(package.contains("/usr/local/opt/whisper-cpp/libexec/lib"))
        XCTAssertTrue(package.contains("/usr/local/opt/whisper-cpp/lib"))
        XCTAssertTrue(package.contains("/usr/local/opt/ggml/lib"))
        XCTAssertTrue(package.contains("/usr/local/opt/whisper-cpp/libexec/include"))
        XCTAssertTrue(package.contains("/usr/local/opt/whisper-cpp/include"))
        XCTAssertTrue(package.contains("/usr/local/opt/ggml/include"))
        XCTAssertTrue(package.contains("-Xcc"))
    }

    func testCWhisperShimDiscoversHeadersThroughStableHomebrewPrefixes() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let shim = try loadMakefile(
            repoRoot.appendingPathComponent("projects/dictator/src/Sources/CWhisper/shim.h")
        )

        XCTAssertFalse(shim.contains("/Cellar/"), "CWhisper shim must not name version-specific Homebrew Cellar paths")
        XCTAssertTrue(shim.contains("<whisper.h>"))
        XCTAssertTrue(shim.contains("<ggml-backend.h>"))
        XCTAssertTrue(shim.contains("/opt/homebrew/opt/whisper-cpp/libexec/include/whisper.h"))
        XCTAssertTrue(shim.contains("/opt/homebrew/opt/whisper-cpp/include/whisper.h"))
        XCTAssertTrue(shim.contains("/opt/homebrew/opt/ggml/include/ggml-backend.h"))
        XCTAssertTrue(shim.contains("/usr/local/opt/whisper-cpp/libexec/include/whisper.h"))
        XCTAssertTrue(shim.contains("/usr/local/opt/whisper-cpp/include/whisper.h"))
        XCTAssertTrue(shim.contains("/usr/local/opt/ggml/include/ggml-backend.h"))
    }

    private func loadMakefile(_ url: URL) throws -> String
    {
        try String(contentsOf: url, encoding: .utf8)
    }

    private func targetDependencies(_ target: String, in makefile: String) -> [String]
    {
        guard let line = makefile.split(separator: "\n").map(String.init).first(where: { $0.hasPrefix("\(target):") })
        else { return [] }

        return line
            .dropFirst(target.count + 1)
            .split { $0 == " " || $0 == "\t" }
            .map(String.init)
    }

    private func targetRecipe(_ target: String, in makefile: String) -> [String]
    {
        let lines = makefile.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let targetIndex = lines.firstIndex(where: { $0 == "\(target):" }) else { return [] }

        var recipe: [String] = []
        for line in lines.dropFirst(targetIndex + 1)
        {
            if line.hasPrefix("\t")
            {
                recipe.append(String(line.dropFirst()))
                continue
            }
            if !line.isEmpty { break }
        }
        return recipe
    }
}
