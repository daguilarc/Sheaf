import XCTest
@testable import DictatorService

final class AudioInputResolverTests: XCTestCase {
    func testNilConfiguredInputUsesSystemDefaultWhenDefaultExists() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "default-id", name: "MacBook Microphone", channelCount: 1)
            ],
            defaultDeviceID: "default-id"
        )

        let resolved = resolver.resolve(configuredAudioInput: nil)

        XCTAssertEqual(resolved.mode, .systemDefault)
        XCTAssertTrue(resolved.isAvailable)
        XCTAssertEqual(resolved.device?.id, "default-id")
        XCTAssertNil(resolved.unavailableReason)
    }

    func testBlankConfiguredInputUsesSystemDefaultWhenDefaultExists() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "default-id", name: "MacBook Microphone", channelCount: 1)
            ],
            defaultDeviceID: "default-id"
        )

        let resolved = resolver.resolve(configuredAudioInput: "  ")

        XCTAssertEqual(resolved.mode, .systemDefault)
        XCTAssertTrue(resolved.isAvailable)
        XCTAssertEqual(resolved.device?.id, "default-id")
    }

    func testDefaultModeIsUnavailableWhenDefaultInputIsMissing() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "other-id", name: "Other Microphone", channelCount: 1)
            ],
            defaultDeviceID: "missing-default-id"
        )

        let resolved = resolver.resolve(configuredAudioInput: nil)

        XCTAssertEqual(resolved.mode, .systemDefault)
        XCTAssertFalse(resolved.isAvailable)
        XCTAssertNil(resolved.device)
        XCTAssertNotNil(resolved.unavailableReason)
    }

    func testDefaultModeIsUnavailableWhenDefaultInputIDIsUnknown() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "other-id", name: "Other Microphone", channelCount: 1)
            ],
            defaultDeviceID: nil
        )

        let resolved = resolver.resolve(configuredAudioInput: nil)

        XCTAssertEqual(resolved.mode, .systemDefault)
        XCTAssertFalse(resolved.isAvailable)
        XCTAssertNil(resolved.device)
        XCTAssertNotNil(resolved.unavailableReason)
    }

    func testConfiguredInputMatchesExactIDBeforeSubstring() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "scarlett", name: "Other Device", channelCount: 1),
                AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2)
            ],
            defaultDeviceID: "id-1"
        )

        let resolved = resolver.resolve(configuredAudioInput: "scarlett")

        XCTAssertEqual(resolved.mode, .selected)
        XCTAssertTrue(resolved.isAvailable)
        XCTAssertEqual(resolved.device?.id, "scarlett")
    }

    func testConfiguredInputMatchesUniqueCaseInsensitiveSubstring() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2),
                AudioInputDevice(id: "id-2", name: "Studio Display Microphone", channelCount: 1)
            ],
            defaultDeviceID: "id-2"
        )

        let resolved = resolver.resolve(configuredAudioInput: "scarlett")

        XCTAssertEqual(resolved.mode, .selected)
        XCTAssertTrue(resolved.isAvailable)
        XCTAssertEqual(resolved.device?.id, "id-1")
    }

    func testMissingConfiguredInputIsUnavailableWithoutFallback() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2)
            ],
            defaultDeviceID: "id-1"
        )

        let resolved = resolver.resolve(configuredAudioInput: "missing")

        XCTAssertEqual(resolved.mode, .selected)
        XCTAssertFalse(resolved.isAvailable)
        XCTAssertNil(resolved.device)
        XCTAssertNotNil(resolved.unavailableReason)
    }

    func testAmbiguousConfiguredInputIsUnavailableWithoutFallback() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2),
                AudioInputDevice(id: "id-2", name: "Scarlett Solo", channelCount: 1)
            ],
            defaultDeviceID: "id-1"
        )

        let resolved = resolver.resolve(configuredAudioInput: "scar")

        XCTAssertEqual(resolved.mode, .selected)
        XCTAssertFalse(resolved.isAvailable)
        XCTAssertNil(resolved.device)
        XCTAssertNotNil(resolved.unavailableReason)
    }

    func testDuplicateExactConfiguredNamesAreUnavailableWithoutFallback() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 2),
                AudioInputDevice(id: "id-2", name: "Scarlett 2i2", channelCount: 1)
            ],
            defaultDeviceID: "id-1"
        )

        let resolved = resolver.resolve(configuredAudioInput: "Scarlett 2i2")

        XCTAssertEqual(resolved.mode, .selected)
        XCTAssertFalse(resolved.isAvailable)
        XCTAssertNil(resolved.device)
        XCTAssertNotNil(resolved.unavailableReason)
    }

    func testSelectedDeviceWithNoInputChannelsIsUnavailable() {
        let resolver = StaticAudioInputResolver(
            devices: [
                AudioInputDevice(id: "id-1", name: "Scarlett 2i2", channelCount: 0)
            ],
            defaultDeviceID: "id-1"
        )

        let resolved = resolver.resolve(configuredAudioInput: "Scarlett 2i2")

        XCTAssertEqual(resolved.mode, .selected)
        XCTAssertFalse(resolved.isAvailable)
        XCTAssertEqual(resolved.device?.id, "id-1")
        XCTAssertNotNil(resolved.unavailableReason)
    }
}
