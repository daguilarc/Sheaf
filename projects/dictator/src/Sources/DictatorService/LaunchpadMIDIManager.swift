import CoreMIDI
import DictatorCore
import Foundation

struct LaunchpadTransportProfile: Equatable {
    struct EndpointNames: Equatable {
        let profile: LaunchpadTransportProfile
        let sourceName: String
        let destinationName: String
    }

    struct EndpointCandidate: Equatable {
        let name: String
        let isOnline: Bool
        let entityID: Int32?

        init(name: String, isOnline: Bool, entityID: Int32? = nil) {
            self.name = name
            self.isOnline = isOnline
            self.entityID = entityID
        }
    }

    let model: LaunchpadModel
    let displayName: String
    let endpointMatches: [String]
    let sysexModelID: UInt8

    static let proMk3 = LaunchpadTransportProfile(
        model: .proMk3,
        displayName: "Launchpad Pro Mk3",
        endpointMatches: ["launchpad pro", "lppromk3"],
        sysexModelID: 0x0E
    )
    static let miniMk3 = LaunchpadTransportProfile(
        model: .miniMk3,
        displayName: "Launchpad Mini Mk3",
        endpointMatches: ["launchpad mini", "lpminimk3"],
        sysexModelID: 0x0D
    )

    static func profile(for model: LaunchpadModel) -> LaunchpadTransportProfile {
        switch model {
        case .proMk3:
            return .proMk3
        case .miniMk3:
            return .miniMk3
        }
    }

    static func profiles(for models: [LaunchpadModel]) -> [LaunchpadTransportProfile] {
        models.map(profile(for:))
    }

    func matchesSourceName(_ name: String) -> Bool {
        matchesEndpointName(name)
    }

    func matchesDestinationName(_ name: String) -> Bool {
        matchesEndpointName(name)
    }

    static func selectPreferredEndpointNames(
        from profiles: [LaunchpadTransportProfile],
        sourceNames: [String],
        destinationNames: [String]
    ) -> EndpointNames? {
        selectPreferredEndpointCandidates(
            from: profiles,
            sources: sourceNames.map { EndpointCandidate(name: $0, isOnline: true) },
            destinations: destinationNames.map { EndpointCandidate(name: $0, isOnline: true) }
        )
    }

    static func selectPreferredEndpointCandidates(
        from profiles: [LaunchpadTransportProfile],
        sources: [EndpointCandidate],
        destinations: [EndpointCandidate]
    ) -> EndpointNames? {
        for profile in profiles {
            guard let source = sources.first(where: { $0.isOnline && profile.matchesSourceName($0.name) }),
                  let destination = destinations.first(where: {
                      $0.isOnline
                          && profile.matchesDestinationName($0.name)
                          && endpointsShareEntity(source, $0)
                  }) else {
                continue
            }
            return EndpointNames(profile: profile, sourceName: source.name, destinationName: destination.name)
        }
        return nil
    }

    private static func endpointsShareEntity(_ source: EndpointCandidate, _ destination: EndpointCandidate) -> Bool {
        guard let sourceEntityID = source.entityID, let destinationEntityID = destination.entityID else {
            return true
        }
        return sourceEntityID == destinationEntityID
    }

    private func matchesEndpointName(_ name: String) -> Bool {
        let normalized = name.lowercased()
        return endpointMatches.contains { normalized.contains($0) }
            && normalized.contains("midi")
            && !normalized.contains("daw")
    }
}

final class LaunchpadMIDIManager: LaunchpadTransport {
    enum ConnectionState: Equatable {
        case searching
        case connected(name: String)
    }

    private static let sleepCommand: UInt8 = 0x09
    static let idleSleepInterval: TimeInterval = TimeInterval(Int32.max)
    static let allAddressableCoordinates: [PadCoordinate] = {
        var coordinates: [PadCoordinate] = []
        for y in -1...9 {
            for x in -1...8 {
                let coordinate = PadCoordinate(x: x, y: y)
                if coordinate.isLaunchpadProMk3Addressable {
                    coordinates.append(coordinate)
                }
            }
        }
        return coordinates
    }()

    private let queue = DispatchQueue.main
    private let profiles: [LaunchpadTransportProfile]
    private var scanTimer: DispatchSourceTimer?
    private var idleSleepTimer: DispatchSourceTimer?
    private var topologyScanGeneration: UInt64 = 0

    private var client = MIDIClientRef()
    private var inputPort = MIDIPortRef()
    private var outputPort = MIDIPortRef()

    private var connectedSource = MIDIEndpointRef()
    private var connectedDestination = MIDIEndpointRef()
    private var connectedProfile: LaunchpadTransportProfile?
    private var lastSentColors: [PadCoordinate: PadColor] = [:]

    var onConnectionStateChanged: ((ConnectionState) -> Void)?
    var onPadEvent: ((PadEvent) -> Void)?
    var onSleepStateChanged: ((Bool) -> Void)?

    private(set) var isConnected: Bool = false
    private var isSleeping: Bool = false

    init(preferredModels: [LaunchpadModel] = LaunchpadModel.defaultPreferences) {
        profiles = LaunchpadTransportProfile.profiles(for: preferredModels)
    }

    func start() {
        queue.async { [weak self] in
            guard let self else {
                return
            }

            guard self.setupClientIfNeeded() else {
                TraceLogger.log("launchpad midi setup failed")
                self.publishState(.searching)
                return
            }

            self.scanAndConnect()
            self.armScanTimer()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self else {
                return
            }
            self.scanTimer?.cancel()
            self.scanTimer = nil
            self.topologyScanGeneration &+= 1
            self.disarmIdleSleepTimer()
            self.disconnectCurrentEndpoints()
        }
    }

    func clear() {
        sendBatchPadColors(
            Self.allAddressableCoordinates.map { coordinate in
                PadColorUpdate(coordinate: coordinate, color: .off)
            }
        )
    }

    func setProgrammerModeIfNeeded() {
        guard let connectedProfile else {
            return
        }
        sendRaw(bytes: Self.makeProgrammerModeSysEx(profile: connectedProfile))
    }

    func sendBatchPadColors(_ updates: [PadColorUpdate]) {
        queue.async { [weak self] in
            guard let self else {
                return
            }
            guard self.isConnected, !updates.isEmpty, !self.isSleeping else {
                return
            }

            guard let connectedProfile = self.connectedProfile else {
                return
            }
            let updatesToSend = Self.makeSysExUpdates(from: updates, cachedColors: &self.lastSentColors)
            self.sendRaw(bytes: Self.makePadColorSysEx(from: updatesToSend, profile: connectedProfile))
        }
    }

    static func makeSysExUpdates(
        from incoming: [PadColorUpdate],
        cachedColors: inout [PadCoordinate: PadColor]
    ) -> [PadColorUpdate] {
        for update in incoming where update.coordinate.isLaunchpadProMk3Addressable {
            cachedColors[update.coordinate] = update.color
        }

        // When a single-color SysEx would be sent, expand to full frame payload.
        guard incoming.count == 1 else {
            return incoming
        }

        return allAddressableCoordinates.map { coordinate in
            PadColorUpdate(coordinate: coordinate, color: cachedColors[coordinate] ?? .off)
        }
    }

    static func preferredEndpointName(displayName: String?, name: String?) -> String? {
        if let displayName, !displayName.isEmpty {
            return displayName
        }
        if let name, !name.isEmpty {
            return name
        }
        return nil
    }

    static func makeProgrammerModeSysEx(profile: LaunchpadTransportProfile) -> [UInt8] {
        [0xF0, 0x00, 0x20, 0x29, 0x02, profile.sysexModelID, 0x0E, 0x01, 0xF7]
    }

    static func makeSleepModeSysEx(profile: LaunchpadTransportProfile, isAwake: Bool) -> [UInt8] {
        let mode: UInt8 = isAwake ? 0x01 : 0x00
        return [0xF0, 0x00, 0x20, 0x29, 0x02, profile.sysexModelID, Self.sleepCommand, mode, 0xF7]
    }

    static func makePadColorSysEx(
        from updates: [PadColorUpdate],
        profile: LaunchpadTransportProfile
    ) -> [UInt8] {
        var bytes: [UInt8] = [0xF0, 0x00, 0x20, 0x29, 0x02, profile.sysexModelID, 0x03]
        bytes.reserveCapacity(8 + updates.count * 5)

        for update in updates {
            guard let note = coordinateToNote(update.coordinate) else {
                continue
            }
            bytes.append(0x03)
            bytes.append(note)
            bytes.append(update.color.r / 2)
            bytes.append(update.color.g / 2)
            bytes.append(update.color.b / 2)
        }

        bytes.append(0xF7)
        return bytes
    }

    private func setupClientIfNeeded() -> Bool {
        if client != 0 {
            return true
        }

        var status = MIDIClientCreateWithBlock("dictator.launchpad" as CFString, &client) { [weak self] notificationPtr in
            TraceLogger.log("launchpad midi notification messageID=\(notificationPtr.pointee.messageID.rawValue)")
            self?.queue.async { [weak self] in
                self?.scheduleTopologyScan()
            }
        }
        guard status == noErr else {
            TraceLogger.log("launchpad midi client create failed status=\(status)")
            return false
        }

        status = MIDIInputPortCreateWithBlock(client, "dictator.launchpad.in" as CFString, &inputPort) { [weak self] packetList, _ in
            self?.handlePacketList(packetList)
        }
        guard status == noErr else {
            TraceLogger.log("launchpad midi input port create failed status=\(status)")
            return false
        }

        status = MIDIOutputPortCreate(client, "dictator.launchpad.out" as CFString, &outputPort)
        guard status == noErr else {
            TraceLogger.log("launchpad midi output port create failed status=\(status)")
            return false
        }

        return true
    }

    private func armScanTimer() {
        scanTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 10, repeating: 10)
        timer.setEventHandler { [weak self] in
            self?.scanAndConnect()
        }
        scanTimer = timer
        timer.resume()
    }

    private func scanAndConnect() {
        guard let selection = findPreferredEndpoints() else {
            disconnectCurrentEndpoints()
            publishState(.searching)
            return
        }

        connect(selection)
    }

    private func connect(_ selection: EndpointSelection) {
        if selection.source == connectedSource
            && selection.destination == connectedDestination
            && selection.profile == connectedProfile
            && isConnected {
            return
        }

        disconnectCurrentEndpoints()

        let connectStatus = MIDIPortConnectSource(inputPort, selection.source, nil)
        guard connectStatus == noErr else {
            TraceLogger.log("launchpad midi connect source failed status=\(connectStatus)")
            publishState(.searching)
            return
        }

        connectedSource = selection.source
        connectedDestination = selection.destination
        connectedProfile = selection.profile
        isConnected = true
        isSleeping = false

        setProgrammerModeIfNeeded()
        sendSleepMode(isAwake: true)
        clear()
        armIdleSleepTimer()
        publishState(.connected(name: selection.sourceName ?? selection.profile.displayName))
        TraceLogger.log("launchpad connected profile=\(selection.profile.model.rawValue)")
    }

    private func scheduleTopologyScan() {
        topologyScanGeneration &+= 1
        let generation = topologyScanGeneration
        queue.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, self.topologyScanGeneration == generation else {
                return
            }
            self.scanAndConnect()
        }
    }

    private func disconnectCurrentEndpoints() {
        if connectedSource != 0 {
            _ = MIDIPortDisconnectSource(inputPort, connectedSource)
        }
        connectedSource = 0
        connectedDestination = 0
        connectedProfile = nil
        isConnected = false
        isSleeping = false
        disarmIdleSleepTimer()
    }

    private func publishState(_ state: ConnectionState) {
        DispatchQueue.main.async { [weak self] in
            self?.onConnectionStateChanged?(state)
        }
    }

    private struct EndpointSelection {
        let profile: LaunchpadTransportProfile
        let source: MIDIEndpointRef
        let destination: MIDIEndpointRef
        let sourceName: String?
    }

    private func findPreferredEndpoints() -> EndpointSelection? {
        for profile in profiles {
            let source = findMatchingSource(profile: profile)
            guard source != 0, let sourceEntityID = endpointEntityID(source) else {
                continue
            }
            let destination = findMatchingDestination(profile: profile, entityID: sourceEntityID)
            guard destination != 0 else {
                continue
            }
            return EndpointSelection(
                profile: profile,
                source: source,
                destination: destination,
                sourceName: endpointName(source)
            )
        }
        return nil
    }

    private func findMatchingSource(profile: LaunchpadTransportProfile) -> MIDIEndpointRef {
        let count = MIDIGetNumberOfSources()
        for index in 0..<count {
            let endpoint = MIDIGetSource(index)
            guard endpoint != 0,
                  endpointIsOnline(endpoint),
                  let name = endpointName(endpoint)?.lowercased() else {
                continue
            }
            if profile.matchesSourceName(name) {
                return endpoint
            }
        }

        return 0
    }

    private func findMatchingDestination(
        profile: LaunchpadTransportProfile,
        entityID: Int32
    ) -> MIDIEndpointRef {
        let count = MIDIGetNumberOfDestinations()
        for index in 0..<count {
            let endpoint = MIDIGetDestination(index)
            guard endpoint != 0,
                  endpointIsOnline(endpoint),
                  endpointEntityID(endpoint) == entityID,
                  let name = endpointName(endpoint)?.lowercased() else {
                continue
            }
            if profile.matchesDestinationName(name) {
                return endpoint
            }
        }

        return 0
    }

    private func endpointEntityID(_ endpoint: MIDIEndpointRef) -> Int32? {
        var entity = MIDIEntityRef()
        guard MIDIEndpointGetEntity(endpoint, &entity) == noErr, entity != 0 else {
            return nil
        }

        var uniqueID: Int32 = 0
        guard MIDIObjectGetIntegerProperty(entity, kMIDIPropertyUniqueID, &uniqueID) == noErr else {
            return nil
        }
        return uniqueID
    }

    private func endpointName(_ endpoint: MIDIEndpointRef) -> String? {
        let displayName = endpointStringProperty(endpoint, kMIDIPropertyDisplayName)
        let name = endpointStringProperty(endpoint, kMIDIPropertyName)
        return Self.preferredEndpointName(displayName: displayName, name: name)
    }

    private func endpointStringProperty(_ endpoint: MIDIEndpointRef, _ property: CFString) -> String? {
        var unmanaged: Unmanaged<CFString>?
        let status = MIDIObjectGetStringProperty(endpoint, property, &unmanaged)
        guard status == noErr, let unmanaged else {
            return nil
        }
        return unmanaged.takeRetainedValue() as String
    }

    private func endpointIsOnline(_ endpoint: MIDIEndpointRef) -> Bool {
        var offline: Int32 = 0
        let status = MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyOffline, &offline)
        return status != noErr || offline == 0
    }

    private func handlePacketList(_ packetList: UnsafePointer<MIDIPacketList>) {
        let packetStart = UnsafeRawPointer(packetList)
            .advanced(by: MemoryLayout<MIDIPacketList>.offset(of: \MIDIPacketList.packet)!)
            .assumingMemoryBound(to: MIDIPacket.self)
        var packetPointer = UnsafeMutablePointer(mutating: packetStart)

        for _ in 0..<packetList.pointee.numPackets {
            let packet = packetPointer.pointee
            let packetBytes = withUnsafeBytes(of: packet.data) { raw in
                Array(raw.prefix(Int(packet.length)))
            }

            parseMIDIBytes(packetBytes)
            packetPointer = MIDIPacketNext(packetPointer)
        }
    }

    private func parseMIDIBytes(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else {
            return
        }

        registerInputActivity()

        var index = 0
        while index + 2 < bytes.count {
            let status = bytes[index] & 0xF0
            let note = bytes[index + 1]
            let value = bytes[index + 2]

            if status == 0x90 || status == 0x80 || status == 0xB0 {
                if let coordinate = Self.noteToCoordinate(note), coordinate.isLaunchpadProMk3Addressable {
                    let phase: PadPhase = (status == 0x80 || value == 0) ? .release : .press
                    let event = PadEvent(coordinate: coordinate, phase: phase, velocity: value)
                    DispatchQueue.main.async { [weak self] in
                        self?.onPadEvent?(event)
                    }
                }
                index += 3
                continue
            }

            if bytes[index] >= 0xF0 {
                index += 1
            } else {
                index += 3
            }
        }
    }

    private func sendRaw(bytes: [UInt8]) {
        guard isConnected, connectedDestination != 0 else {
            return
        }

        var rawBuffer = [UInt8](repeating: 0, count: 2048)

        let sendStatus: OSStatus = rawBuffer.withUnsafeMutableBytes { rawBufferPtr in
            guard let packetListPtr = rawBufferPtr.baseAddress?.assumingMemoryBound(to: MIDIPacketList.self) else {
                return -1
            }

            var packet = MIDIPacketListInit(packetListPtr)
            packet = MIDIPacketListAdd(packetListPtr, 2048, packet, 0, bytes.count, bytes)
            return MIDISend(outputPort, connectedDestination, packetListPtr)
        }
        if sendStatus != noErr {
            TraceLogger.log("launchpad midi send failed status=\(sendStatus)")
            disconnectCurrentEndpoints()
            publishState(.searching)
        }
    }

    private func sendSleepMode(isAwake: Bool) {
        guard let connectedProfile else {
            return
        }
        sendRaw(bytes: Self.makeSleepModeSysEx(profile: connectedProfile, isAwake: isAwake))
    }

    private func registerInputActivity() {
        if isSleeping {
            isSleeping = false
            sendSleepMode(isAwake: true)
            publishSleepState(false)
        }
        armIdleSleepTimer()
    }

    private func armIdleSleepTimer() {
        disarmIdleSleepTimer()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + Self.idleSleepInterval)
        timer.setEventHandler { [weak self] in
            guard let self else {
                return
            }
            guard self.isConnected, !self.isSleeping else {
                return
            }
            self.isSleeping = true
            self.sendSleepMode(isAwake: false)
            self.publishSleepState(true)
            TraceLogger.log("launchpad entered sleep after idle interval")
        }
        idleSleepTimer = timer
        timer.resume()
    }

    private func disarmIdleSleepTimer() {
        idleSleepTimer?.cancel()
        idleSleepTimer = nil
    }

    private func publishSleepState(_ sleeping: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.onSleepStateChanged?(sleeping)
        }
    }

    static func noteToCoordinate(_ note: UInt8) -> PadCoordinate? {
        if note < 10 {
            return PadCoordinate(x: Int(note) - 1, y: 9)
        }

        var y = (Int(note) - 11) / 10
        var x = (Int(note) - 11) % 10

        if y == 9 {
            y = -1
        }

        if x == 9 {
            x = -1
            y += 1
        }

        let coordinate = PadCoordinate(x: x, y: 7 - y)
        guard coordinate.isLaunchpadProMk3Addressable else {
            return nil
        }

        return coordinate
    }

    static func coordinateToNote(_ coordinate: PadCoordinate) -> UInt8? {
        guard coordinate.isLaunchpadProMk3Addressable else {
            return nil
        }

        var y = 8 - coordinate.y - 1
        if y == -1 {
            y = 9
        } else if y == -2 {
            y = -1
        }

        let note = 11 + (10 * y) + coordinate.x
        guard (0...127).contains(note) else {
            return nil
        }

        return UInt8(note)
    }
}
