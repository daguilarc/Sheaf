import CoreMIDI
import Foundation

final class LaunchpadMIDIManager: LaunchpadTransport {
    enum ConnectionState: Equatable {
        case searching
        case connected(name: String)
    }

    private static let deviceMatch = "launchpad pro"
    private static let sysexModelID: UInt8 = 0x0E
    private static let sleepCommand: UInt8 = 0x09
    private static let idleSleepInterval: TimeInterval = 600
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

    private let queue = DispatchQueue(label: "dictator.launchpad.midi")
    private var scanTimer: DispatchSourceTimer?
    private var idleSleepTimer: DispatchSourceTimer?

    private var client = MIDIClientRef()
    private var inputPort = MIDIPortRef()
    private var outputPort = MIDIPortRef()

    private var connectedSource = MIDIEndpointRef()
    private var connectedDestination = MIDIEndpointRef()
    private var lastSentColors: [PadCoordinate: PadColor] = [:]

    var onConnectionStateChanged: ((ConnectionState) -> Void)?
    var onPadEvent: ((PadEvent) -> Void)?
    var onSleepStateChanged: ((Bool) -> Void)?

    private(set) var isConnected: Bool = false
    private var isSleeping: Bool = false

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
        // Launchpad Pro Mk3: SysEx message to enter programmer mode.
        sendRaw(bytes: [0xF0, 0x00, 0x20, 0x29, 0x02, Self.sysexModelID, 0x0E, 0x01, 0xF7])
    }

    func sendBatchPadColors(_ updates: [PadColorUpdate]) {
        queue.async { [weak self] in
            guard let self else {
                return
            }
            guard self.isConnected, !updates.isEmpty, !self.isSleeping else {
                return
            }

            let updatesToSend = Self.makeSysExUpdates(from: updates, cachedColors: &self.lastSentColors)

            var bytes: [UInt8] = [0xF0, 0x00, 0x20, 0x29, 0x02, Self.sysexModelID, 0x03]
            bytes.reserveCapacity(8 + updatesToSend.count * 5)

            for update in updatesToSend {
                guard let note = Self.coordinateToNote(update.coordinate) else {
                    continue
                }
                bytes.append(0x03)
                bytes.append(note)
                bytes.append(update.color.r / 2)
                bytes.append(update.color.g / 2)
                bytes.append(update.color.b / 2)
            }

            bytes.append(0xF7)
            self.sendRaw(bytes: bytes)
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

    private func setupClientIfNeeded() -> Bool {
        if client != 0 {
            return true
        }

        var status = MIDIClientCreateWithBlock("dictator.launchpad" as CFString, &client) { notificationPtr in
            TraceLogger.log("launchpad midi notification messageID=\(notificationPtr.pointee.messageID.rawValue)")
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
        let source = findMatchingSource()
        let destination = findMatchingDestination()

        if source == 0 || destination == 0 {
            disconnectCurrentEndpoints()
            publishState(.searching)
            return
        }

        if source == connectedSource && destination == connectedDestination && isConnected {
            return
        }

        disconnectCurrentEndpoints()

        let connectStatus = MIDIPortConnectSource(inputPort, source, nil)
        guard connectStatus == noErr else {
            TraceLogger.log("launchpad midi connect source failed status=\(connectStatus)")
            publishState(.searching)
            return
        }

        connectedSource = source
        connectedDestination = destination
        isConnected = true
        isSleeping = false

        setProgrammerModeIfNeeded()
        sendSleepMode(isAwake: true)
        clear()
        armIdleSleepTimer()
        publishState(.connected(name: endpointName(source) ?? "Launchpad Pro Mk3"))
        TraceLogger.log("launchpad connected")
    }

    private func disconnectCurrentEndpoints() {
        if connectedSource != 0 {
            _ = MIDIPortDisconnectSource(inputPort, connectedSource)
        }
        connectedSource = 0
        connectedDestination = 0
        isConnected = false
        isSleeping = false
        disarmIdleSleepTimer()
    }

    private func publishState(_ state: ConnectionState) {
        DispatchQueue.main.async { [weak self] in
            self?.onConnectionStateChanged?(state)
        }
    }

    private func findMatchingSource() -> MIDIEndpointRef {
        let count = MIDIGetNumberOfSources()
        for index in 0..<count {
            let endpoint = MIDIGetSource(index)
            guard endpoint != 0,
                  let name = endpointName(endpoint)?.lowercased() else {
                continue
            }
            if name.contains(Self.deviceMatch) {
                return endpoint
            }
        }

        return 0
    }

    private func findMatchingDestination() -> MIDIEndpointRef {
        let count = MIDIGetNumberOfDestinations()
        for index in 0..<count {
            let endpoint = MIDIGetDestination(index)
            guard endpoint != 0,
                  let name = endpointName(endpoint)?.lowercased() else {
                continue
            }
            if name.contains(Self.deviceMatch) {
                return endpoint
            }
        }

        return 0
    }

    private func endpointName(_ endpoint: MIDIEndpointRef) -> String? {
        var unmanaged: Unmanaged<CFString>?
        let status = MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &unmanaged)
        guard status == noErr, let unmanaged else {
            return nil
        }
        return unmanaged.takeRetainedValue() as String
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
        let mode: UInt8 = isAwake ? 0x01 : 0x00
        sendRaw(bytes: [0xF0, 0x00, 0x20, 0x29, 0x02, Self.sysexModelID, Self.sleepCommand, mode, 0xF7])
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
