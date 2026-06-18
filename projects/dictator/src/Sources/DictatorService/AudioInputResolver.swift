import CoreAudio
import Foundation

public struct AudioInputDevice: Sendable, Equatable {
    public let id: String
    public let name: String
    public let channelCount: Int

    public init(id: String, name: String, channelCount: Int) {
        self.id = id
        self.name = name
        self.channelCount = channelCount
    }
}

public struct ResolvedAudioInput: Sendable, Equatable {
    public enum Mode: Sendable, Equatable {
        case systemDefault
        case selected
    }

    public let mode: Mode
    public let configuredValue: String?
    public let device: AudioInputDevice?
    public let isAvailable: Bool
    public let unavailableReason: String?

    public init(
        mode: Mode,
        configuredValue: String?,
        device: AudioInputDevice?,
        isAvailable: Bool,
        unavailableReason: String?
    ) {
        self.mode = mode
        self.configuredValue = configuredValue
        self.device = device
        self.isAvailable = isAvailable
        self.unavailableReason = unavailableReason
    }
}

public protocol AudioInputResolving: Sendable {
    func availableInputs() -> [AudioInputDevice]
    func resolve(configuredAudioInput: String?) -> ResolvedAudioInput
}

public struct StaticAudioInputResolver: AudioInputResolving {
    private let devices: [AudioInputDevice]
    private let defaultDeviceID: String?

    public init(devices: [AudioInputDevice], defaultDeviceID: String? = nil) {
        self.devices = devices
        self.defaultDeviceID = defaultDeviceID
    }

    public func availableInputs() -> [AudioInputDevice] {
        devices
    }

    public func resolve(configuredAudioInput: String?) -> ResolvedAudioInput {
        AudioInputResolution.resolve(
            configuredAudioInput: configuredAudioInput,
            devices: devices,
            defaultDeviceID: defaultDeviceID
        )
    }
}

public struct SystemAudioInputResolver: AudioInputResolving {
    public init() {}

    public func availableInputs() -> [AudioInputDevice] {
        SystemAudioInputResolver.availableCoreAudioInputs().map(\.device)
    }

    public func resolve(configuredAudioInput: String?) -> ResolvedAudioInput {
        let inputs = SystemAudioInputResolver.availableCoreAudioInputs()
        return AudioInputResolution.resolve(
            configuredAudioInput: configuredAudioInput,
            devices: inputs.map(\.device),
            defaultDeviceID: SystemAudioInputResolver.defaultInputDeviceUID()
        )
    }

    public static func applySelectedInput(_ selection: AudioRecorder.AudioInputSelection) -> (() -> Void)? {
        let previousDeviceID = defaultInputDeviceID()
        guard let deviceID = coreAudioDeviceID(for: selection.device.id) else {
            return nil
        }

        var mutableDeviceID = deviceID
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            UInt32(MemoryLayout<AudioDeviceID>.size),
            &mutableDeviceID
        )
        guard status == noErr else {
            return nil
        }
        return {
            guard let previousDeviceID else {
                return
            }
            var mutablePreviousDeviceID = previousDeviceID
            var restoreAddress = AudioObjectPropertyAddress(
                mSelector: kAudioHardwarePropertyDefaultInputDevice,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            _ = AudioObjectSetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &restoreAddress,
                0,
                nil,
                UInt32(MemoryLayout<AudioDeviceID>.size),
                &mutablePreviousDeviceID
            )
        }
    }

    private struct CoreAudioInput {
        let deviceID: AudioDeviceID
        let uid: String
        let device: AudioInputDevice
    }

    private static func availableCoreAudioInputs() -> [CoreAudioInput] {
        coreAudioDeviceIDs().compactMap { deviceID in
            let channelCount = inputChannelCount(for: deviceID)
            guard channelCount > 0 else {
                return nil
            }
            let uid = deviceUID(for: deviceID) ?? String(deviceID)
            let name = deviceName(for: deviceID) ?? uid
            return CoreAudioInput(
                deviceID: deviceID,
                uid: uid,
                device: AudioInputDevice(id: uid, name: name, channelCount: channelCount)
            )
        }
    }

    private static func defaultInputDeviceUID() -> String? {
        guard let deviceID = defaultInputDeviceID() else {
            return nil
        }
        return deviceUID(for: deviceID) ?? String(deviceID)
    }

    private static func defaultInputDeviceID() -> AudioDeviceID? {
        var deviceID = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &deviceID
        )
        guard status == noErr, deviceID != 0 else {
            return nil
        }
        return deviceID
    }

    private static func coreAudioDeviceIDs() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size
        ) == noErr else {
            return []
        }

        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = Array(repeating: AudioDeviceID(0), count: count)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &deviceIDs
        )
        guard status == noErr else {
            return []
        }
        return deviceIDs
    }

    private static func coreAudioDeviceID(for deviceIdentifier: String) -> AudioDeviceID? {
        if let numericID = AudioDeviceID(deviceIdentifier) {
            return numericID
        }
        return availableCoreAudioInputs()
            .first { $0.uid == deviceIdentifier || $0.device.id == deviceIdentifier || $0.device.name == deviceIdentifier }?
            .deviceID
    }

    private static func deviceUID(for deviceID: AudioDeviceID) -> String? {
        stringProperty(kAudioDevicePropertyDeviceUID, for: deviceID)
    }

    private static func deviceName(for deviceID: AudioDeviceID) -> String? {
        stringProperty(kAudioObjectPropertyName, for: deviceID)
    }

    private static func stringProperty(_ selector: AudioObjectPropertySelector, for deviceID: AudioDeviceID) -> String? {
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &value)
        guard status == noErr else {
            return nil
        }
        return value?.takeRetainedValue() as String?
    }

    private static func inputChannelCount(for deviceID: AudioDeviceID) -> Int {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr, size > 0 else {
            return 0
        }

        let bufferList = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer {
            bufferList.deallocate()
        }

        let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, bufferList)
        guard status == noErr else {
            return 0
        }

        let audioBufferList = bufferList.bindMemory(to: AudioBufferList.self, capacity: 1)
        let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
        return buffers.reduce(0) { $0 + Int($1.mNumberChannels) }
    }
}

private enum AudioInputResolution {
    static func resolve(
        configuredAudioInput: String?,
        devices: [AudioInputDevice],
        defaultDeviceID: String?
    ) -> ResolvedAudioInput {
        let trimmed = configuredAudioInput?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let configuredValue = trimmed, !configuredValue.isEmpty else {
            return resolveDefault(devices: devices, defaultDeviceID: defaultDeviceID)
        }

        let exactMatches = devices.filter { $0.id == configuredValue || $0.name == configuredValue }
        if exactMatches.count == 1, let exactMatch = exactMatches.first {
            return resolveSelected(configuredValue: configuredValue, device: exactMatch)
        }
        if exactMatches.count > 1 {
            return ResolvedAudioInput(
                mode: .selected,
                configuredValue: configuredValue,
                device: nil,
                isAvailable: false,
                unavailableReason: "Audio input '\(configuredValue)' is ambiguous"
            )
        }

        let lowered = configuredValue.lowercased()
        let substringMatches = devices.filter {
            $0.id.lowercased().contains(lowered) || $0.name.lowercased().contains(lowered)
        }

        guard substringMatches.count == 1, let match = substringMatches.first else {
            let reason = substringMatches.isEmpty
                ? "Audio input '\(configuredValue)' was not found"
                : "Audio input '\(configuredValue)' is ambiguous"
            return ResolvedAudioInput(
                mode: .selected,
                configuredValue: configuredValue,
                device: nil,
                isAvailable: false,
                unavailableReason: reason
            )
        }

        return resolveSelected(configuredValue: configuredValue, device: match)
    }

    private static func resolveDefault(devices: [AudioInputDevice], defaultDeviceID: String?) -> ResolvedAudioInput {
        guard let defaultDeviceID else {
            return ResolvedAudioInput(
                mode: .systemDefault,
                configuredValue: nil,
                device: nil,
                isAvailable: false,
                unavailableReason: "No default audio input is available"
            )
        }

        let defaultDevice = devices.first { $0.id == defaultDeviceID }

        guard let defaultDevice else {
            return ResolvedAudioInput(
                mode: .systemDefault,
                configuredValue: nil,
                device: nil,
                isAvailable: false,
                unavailableReason: "No default audio input is available"
            )
        }

        guard defaultDevice.channelCount > 0 else {
            return ResolvedAudioInput(
                mode: .systemDefault,
                configuredValue: nil,
                device: defaultDevice,
                isAvailable: false,
                unavailableReason: "Default audio input has no input channels"
            )
        }

        return ResolvedAudioInput(
            mode: .systemDefault,
            configuredValue: nil,
            device: defaultDevice,
            isAvailable: true,
            unavailableReason: nil
        )
    }

    private static func resolveSelected(configuredValue: String, device: AudioInputDevice) -> ResolvedAudioInput {
        guard device.channelCount > 0 else {
            return ResolvedAudioInput(
                mode: .selected,
                configuredValue: configuredValue,
                device: device,
                isAvailable: false,
                unavailableReason: "Audio input '\(device.name)' has no input channels"
            )
        }

        return ResolvedAudioInput(
            mode: .selected,
            configuredValue: configuredValue,
            device: device,
            isAvailable: true,
            unavailableReason: nil
        )
    }
}
