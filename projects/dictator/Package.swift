// swift-tools-version: 5.10
import PackageDescription

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
            linkerSettings: [
                .linkedLibrary("whisper"),
                .linkedLibrary("ggml"),
                .linkedLibrary("ggml-base"),
                .unsafeFlags([
                    "-L/opt/homebrew/Cellar/whisper-cpp/1.8.3/libexec/lib",
                    "-L/opt/homebrew/lib",
                    "-L/usr/local/lib"
                ])
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
            path: "src/Sources/DictatorService"
        ),
        .testTarget(
            name: "DictatorCoreTests",
            dependencies: ["DictatorCore"],
            path: "tests/DictatorCoreTests"
        ),
        .testTarget(
            name: "DictatorServiceTests",
            dependencies: ["DictatorService"],
            path: "tests/DictatorServiceTests"
        )
    ]
)
