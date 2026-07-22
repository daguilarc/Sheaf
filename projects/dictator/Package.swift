// swift-tools-version: 5.10
import Foundation
import PackageDescription

let dictatorHomebrewLibrarySearchPaths = [
    "/opt/homebrew/opt/whisper-cpp/libexec/lib",
    "/opt/homebrew/opt/whisper-cpp/lib",
    "/opt/homebrew/opt/ggml/lib",
    "/usr/local/opt/whisper-cpp/libexec/lib",
    "/usr/local/opt/whisper-cpp/lib",
    "/usr/local/opt/ggml/lib"
]

let dictatorHomebrewIncludeSearchPaths = [
    "/opt/homebrew/opt/whisper-cpp/libexec/include",
    "/opt/homebrew/opt/whisper-cpp/include",
    "/opt/homebrew/opt/ggml/include",
    "/usr/local/opt/whisper-cpp/libexec/include",
    "/usr/local/opt/whisper-cpp/include",
    "/usr/local/opt/ggml/include"
]

func dictatorExistingLibrarySearchFlags() -> [String] {
    dictatorHomebrewLibrarySearchPaths.compactMap { path in
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory),
              isDirectory.boolValue
        else { return nil }
        return "-L\(path)"
    }
}

func dictatorExistingCIncludeSearchFlags() -> [String] {
    dictatorHomebrewIncludeSearchPaths.flatMap { path -> [String] in
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory),
              isDirectory.boolValue
        else { return [] }
        return ["-Xcc", "-I\(path)"]
    }
}

let package = Package(
    name: "Dictator",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "DictatorCore", targets: ["DictatorCore"]),
        .executable(name: "DictatorService", targets: ["DictatorService"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.67.0")
    ],
    targets: [
        .systemLibrary(
            name: "CWhisper",
            path: "src/Sources/CWhisper"
        ),
        .target(
            name: "DictatorCore",
            dependencies: ["CWhisper"],
            path: "src/Sources/DictatorCore",
            swiftSettings: [
                .unsafeFlags(dictatorExistingCIncludeSearchFlags())
            ],
            linkerSettings: [
                .linkedLibrary("whisper"),
                .linkedLibrary("ggml"),
                .linkedLibrary("ggml-base"),
                .unsafeFlags(dictatorExistingLibrarySearchFlags())
            ]
        ),
        .executableTarget(
            name: "DictatorService",
            dependencies: [
                "DictatorCore",
                .product(name: "NIO", package: "swift-nio"),
                .product(name: "NIOHTTP1", package: "swift-nio"),
                .product(name: "NIOWebSocket", package: "swift-nio")
            ],
            path: "src/Sources/DictatorService",
            swiftSettings: [
                .unsafeFlags(dictatorExistingCIncludeSearchFlags())
            ]
        ),
        .testTarget(
            name: "DictatorCoreTests",
            dependencies: ["DictatorCore"],
            path: "tests/DictatorCoreTests",
            swiftSettings: [
                .unsafeFlags(dictatorExistingCIncludeSearchFlags())
            ]
        ),
        .testTarget(
            name: "DictatorServiceTests",
            dependencies: ["DictatorService"],
            path: "tests/DictatorServiceTests",
            swiftSettings: [
                .unsafeFlags(dictatorExistingCIncludeSearchFlags())
            ]
        )
    ]
)
