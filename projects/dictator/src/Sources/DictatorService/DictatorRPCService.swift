import DictatorCore
import Foundation

struct DictatorRPCError: Error, Codable, Equatable {
    let code: String
    let message: String

    static func invalidRequest(_ message: String) -> DictatorRPCError {
        DictatorRPCError(code: "invalid_request", message: message)
    }

    static func methodNotFound(_ method: String) -> DictatorRPCError {
        DictatorRPCError(code: "method_not_found", message: "unsupported method: \(method)")
    }

    static func conflict(_ message: String) -> DictatorRPCError {
        DictatorRPCError(code: "conflict", message: message)
    }

    static func insertionFailed(_ message: String) -> DictatorRPCError {
        DictatorRPCError(code: "insert_failed", message: message)
    }
}

struct DictatorRPCEnvelope: Codable, Equatable {
    let id: String?
    let method: String?
    let params: JSONValue?
    let result: JSONValue?
    let error: DictatorRPCError?

    init(
        id: String? = nil,
        method: String? = nil,
        params: JSONValue? = nil,
        result: JSONValue? = nil,
        error: DictatorRPCError? = nil
    ) {
        self.id = id
        self.method = method
        self.params = params
        self.result = result
        self.error = error
    }
}

enum JSONValue: Codable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .object(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case let .string(value):
            try container.encode(value)
        case let .number(value):
            try container.encode(value)
        case let .bool(value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var objectValue: [String: JSONValue]? {
        if case let .object(value) = self {
            return value
        }
        return nil
    }

    var arrayValue: [JSONValue]? {
        if case let .array(value) = self {
            return value
        }
        return nil
    }

    var stringValue: String? {
        if case let .string(value) = self {
            return value
        }
        return nil
    }

    var intValue: Int? {
        if case let .number(value) = self {
            return Int(value)
        }
        return nil
    }

}

struct DictatorRPCDiagnostic: Codable, Equatable {
    let connected_clients: Int
    let owned_cells: Int
    let pushed_context_blocks: Int
}

final class DictatorRPCService: @unchecked Sendable {
    typealias EventSink = @Sendable (String) -> Void
    typealias InsertText = @Sendable (String) -> Result<Void, ClipboardInserter.InsertError>

    private struct ClientSession {
        let clientID: String
        let connectedAt: Date
        var lastContact: Date
        let send: EventSink
        var contextBlocks: [String: RefinementContextBlock]
    }

    private struct OwnedCell {
        let sessionID: String
        let clientID: String
        var color: PadColor
    }

    private static let maxInsertBytes = 1024 * 1024

    private let lock = NSLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let insertText: InsertText
    private let heartbeatTimeoutSeconds: TimeInterval
    private var sessions: [String: ClientSession] = [:]
    private var cells: [PadCoordinate: OwnedCell] = [:]
    private var eventSequence: UInt64 = 0
    private var onChange: (() -> Void)?

    init(
        heartbeatTimeoutSeconds: TimeInterval = 30,
        insertText: @escaping InsertText = { text in ClipboardInserter.insertPreservingClipboard(text) }
    ) {
        self.heartbeatTimeoutSeconds = heartbeatTimeoutSeconds
        self.insertText = insertText
    }

    func setOnChange(_ onChange: (() -> Void)?) {
        lock.lock()
        self.onChange = onChange
        lock.unlock()
    }

    func registerClient(clientID: String, send: @escaping EventSink) -> String {
        let sessionID = UUID().uuidString
        lock.lock()
        sessions[sessionID] = ClientSession(
            clientID: clientID,
            connectedAt: Date(),
            lastContact: Date(),
            send: send,
            contextBlocks: [:]
        )
        lock.unlock()
        sendEvent(
            method: "rpc.hello",
            params: .object([
                "protocolVersion": .number(1),
                "capabilities": .array([
                    .string("launchpad.cells"),
                    .string("cursor.insertText"),
                    .string("dictationContext")
                ])
            ]),
            to: sessionID
        )
        return sessionID
    }

    func unregisterClient(sessionID: String) {
        let callback: (() -> Void)?
        lock.lock()
        sessions.removeValue(forKey: sessionID)
        cells = cells.filter { $0.value.sessionID != sessionID }
        callback = onChange
        lock.unlock()
        callback?()
    }

    func handleTextFrame(_ text: String, sessionID: String) -> String? {
        var requestID: String?
        let response: DictatorRPCEnvelope
        do {
            let envelope = try decoder.decode(DictatorRPCEnvelope.self, from: Data(text.utf8))
            requestID = envelope.id
            guard let id = envelope.id, !id.isEmpty else {
                return nil
            }
            guard let method = envelope.method, !method.isEmpty else {
                response = DictatorRPCEnvelope(id: id, error: .invalidRequest("method is required"))
                return encode(response)
            }
            let result = try handle(method: method, params: envelope.params, sessionID: sessionID)
            response = DictatorRPCEnvelope(id: id, result: result)
        } catch let error as DictatorRPCError {
            response = DictatorRPCEnvelope(id: requestID, error: error)
        } catch {
            response = DictatorRPCEnvelope(id: requestID, error: .invalidRequest("invalid JSON-RPC envelope"))
        }
        return encode(response)
    }

    func color(at coordinate: PadCoordinate) -> PadColor? {
        let callback: (() -> Void)?
        lock.lock()
        let expired = cleanupExpiredLocked(now: Date())
        callback = expired ? onChange : nil
        let color = cells[coordinate]?.color
        lock.unlock()
        callback?()
        return color
    }

    func ownedCoordinates() -> [PadCoordinate] {
        let callback: (() -> Void)?
        lock.lock()
        let expired = cleanupExpiredLocked(now: Date())
        callback = expired ? onChange : nil
        let coordinates = Array(cells.keys)
        lock.unlock()
        callback?()
        return coordinates
    }

    func handleLaunchpadEvent(_ event: PadEvent) -> Bool {
        let target: (sessionID: String, sequence: UInt64)?
        let callback: (() -> Void)?
        lock.lock()
        let expired = cleanupExpiredLocked(now: Date())
        callback = expired ? onChange : nil
        if let cell = cells[event.coordinate], sessions[cell.sessionID] != nil {
            eventSequence += 1
            target = (cell.sessionID, eventSequence)
        } else {
            target = nil
        }
        lock.unlock()
        callback?()

        guard let target else {
            return false
        }

        sendEvent(
            method: event.phase == .press ? "launchpad.cellPressed" : "launchpad.cellReleased",
            params: .object([
                "x": .number(Double(event.coordinate.x)),
                "y": .number(Double(event.coordinate.y)),
                "sequence": .number(Double(target.sequence))
            ]),
            to: target.sessionID
        )
        return true
    }

    func activeContextBlocks() -> [RefinementContextBlock] {
        lock.lock()
        defer { lock.unlock() }
        return sessions.values
            .sorted { $0.connectedAt < $1.connectedAt }
            .flatMap { session in
                session.contextBlocks.keys.sorted().compactMap { session.contextBlocks[$0] }
            }
    }

    func diagnostics() -> DictatorRPCDiagnostic {
        lock.lock()
        _ = cleanupExpiredLocked(now: Date())
        defer { lock.unlock() }
        let contextCount = sessions.values.reduce(0) { $0 + $1.contextBlocks.count }
        return DictatorRPCDiagnostic(
            connected_clients: sessions.count,
            owned_cells: cells.count,
            pushed_context_blocks: contextCount
        )
    }

    func cleanupExpiredSessions(now: Date = Date()) {
        let callback: (() -> Void)?
        lock.lock()
        let expired = cleanupExpiredLocked(now: now)
        callback = expired ? onChange : nil
        lock.unlock()
        callback?()
    }

    private func handle(method: String, params: JSONValue?, sessionID: String) throws -> JSONValue {
        touch(sessionID: sessionID)
        switch method {
        case "rpc.ping":
            return .object(["ok": .bool(true)])
        case "launchpad.setCells":
            try setCells(params: params, sessionID: sessionID)
            return .object(["ok": .bool(true)])
        case "launchpad.releaseCells":
            try releaseCells(params: params, sessionID: sessionID)
            return .object(["ok": .bool(true)])
        case "cursor.insertText":
            try insertTextFromRPC(params: params)
            return .object(["ok": .bool(true)])
        case "dictationContext.push":
            try pushContext(params: params, sessionID: sessionID)
            return .object(["ok": .bool(true)])
        case "dictationContext.pop":
            try popContext(params: params, sessionID: sessionID)
            return .object(["ok": .bool(true)])
        default:
            throw DictatorRPCError.methodNotFound(method)
        }
    }

    private func setCells(params: JSONValue?, sessionID: String) throws {
        let object = try requireObject(params)
        guard let cellValues = object["cells"]?.arrayValue else {
            throw DictatorRPCError.invalidRequest("cells array is required")
        }
        let requested = try cellValues.map(parseCell)
        let callback: (() -> Void)?

        lock.lock()
        guard let session = sessions[sessionID] else {
            lock.unlock()
            throw DictatorRPCError.invalidRequest("client session not found")
        }
        for cell in requested {
            if let owner = cells[cell.coordinate], owner.sessionID != sessionID {
                lock.unlock()
                throw DictatorRPCError.conflict(
                    "cell \(cell.coordinate.x),\(cell.coordinate.y) is owned by \(owner.clientID)"
                )
            }
        }
        for cell in requested {
            cells[cell.coordinate] = OwnedCell(
                sessionID: sessionID,
                clientID: session.clientID,
                color: cell.color
            )
        }
        callback = onChange
        lock.unlock()
        callback?()
    }

    private func releaseCells(params: JSONValue?, sessionID: String) throws {
        let object = try requireObject(params)
        guard let coordinateValues = object["coordinates"]?.arrayValue else {
            throw DictatorRPCError.invalidRequest("coordinates array is required")
        }
        let coordinates = try coordinateValues.map(parseCoordinate)
        let callback: (() -> Void)?
        lock.lock()
        for coordinate in coordinates where cells[coordinate]?.sessionID == sessionID {
            cells.removeValue(forKey: coordinate)
        }
        callback = onChange
        lock.unlock()
        callback?()
    }

    private func insertTextFromRPC(params: JSONValue?) throws {
        let object = try requireObject(params)
        guard let text = object["text"]?.stringValue else {
            throw DictatorRPCError.invalidRequest("text is required")
        }
        guard !text.isEmpty else {
            throw DictatorRPCError.invalidRequest("text must be non-empty")
        }
        guard Data(text.utf8).count <= Self.maxInsertBytes else {
            throw DictatorRPCError.invalidRequest("text exceeds 1 MiB UTF-8 limit")
        }
        switch insertText(text) {
        case .success:
            return
        case let .failure(error):
            throw DictatorRPCError.insertionFailed(String(describing: error))
        }
    }

    private func pushContext(params: JSONValue?, sessionID: String) throws {
        let object = try requireObject(params)
        guard let id = object["id"]?.stringValue, !id.isEmpty else {
            throw DictatorRPCError.invalidRequest("id is required")
        }
        guard let title = object["title"]?.stringValue, !title.isEmpty else {
            throw DictatorRPCError.invalidRequest("title is required")
        }
        guard let body = object["body"]?.stringValue else {
            throw DictatorRPCError.invalidRequest("body is required")
        }
        let metadata = object["metadata"]?.objectValue?.compactMapValues { $0.stringValue } ?? [:]
        lock.lock()
        guard var session = sessions[sessionID] else {
            lock.unlock()
            throw DictatorRPCError.invalidRequest("client session not found")
        }
        session.contextBlocks[id] = RefinementContextBlock(title: title, metadata: metadata, body: body)
        sessions[sessionID] = session
        lock.unlock()
    }

    private func popContext(params: JSONValue?, sessionID: String) throws {
        let object = try requireObject(params)
        guard let id = object["id"]?.stringValue, !id.isEmpty else {
            throw DictatorRPCError.invalidRequest("id is required")
        }
        lock.lock()
        if var session = sessions[sessionID] {
            session.contextBlocks.removeValue(forKey: id)
            sessions[sessionID] = session
        }
        lock.unlock()
    }

    private func touch(sessionID: String) {
        lock.lock()
        if var session = sessions[sessionID] {
            session.lastContact = Date()
            sessions[sessionID] = session
        }
        lock.unlock()
    }

    private func cleanupExpiredLocked(now: Date) -> Bool {
        guard heartbeatTimeoutSeconds > 0 else {
            return false
        }
        let expiredSessionIDs = sessions.compactMap { sessionID, session in
            now.timeIntervalSince(session.lastContact) > heartbeatTimeoutSeconds ? sessionID : nil
        }
        guard !expiredSessionIDs.isEmpty else {
            return false
        }
        let expired = Set(expiredSessionIDs)
        for sessionID in expired {
            sessions.removeValue(forKey: sessionID)
        }
        cells = cells.filter { !expired.contains($0.value.sessionID) }
        return true
    }

    private func sendEvent(method: String, params: JSONValue, to sessionID: String) {
        let sink: EventSink?
        lock.lock()
        sink = sessions[sessionID]?.send
        lock.unlock()
        guard let sink, let encoded = encode(DictatorRPCEnvelope(method: method, params: params)) else {
            return
        }
        sink(encoded)
    }

    private func encode(_ envelope: DictatorRPCEnvelope) -> String? {
        guard let data = try? encoder.encode(envelope) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func requireObject(_ params: JSONValue?) throws -> [String: JSONValue] {
        guard let object = params?.objectValue else {
            throw DictatorRPCError.invalidRequest("params object is required")
        }
        return object
    }

    private func parseCell(_ value: JSONValue) throws -> (coordinate: PadCoordinate, color: PadColor) {
        let object = try requireObject(value)
        let coordinate = try parseCoordinate(value)
        let color: PadColor
        if object["off"] == .bool(true) || object["state"]?.stringValue == "off" {
            color = .off
        } else if let colorObject = object["color"]?.objectValue {
            color = try parseColor(colorObject)
        } else {
            color = try parseColor(object)
        }
        return (coordinate, color)
    }

    private func parseCoordinate(_ value: JSONValue) throws -> PadCoordinate {
        let object = try requireObject(value)
        guard let x = object["x"]?.intValue, let y = object["y"]?.intValue else {
            throw DictatorRPCError.invalidRequest("cell x and y are required")
        }
        let coordinate = PadCoordinate(x: x, y: y)
        guard coordinate.isLaunchpadProMk3Addressable else {
            throw DictatorRPCError.invalidRequest("cell coordinate is out of range")
        }
        return coordinate
    }

    private func parseColor(_ object: [String: JSONValue]) throws -> PadColor {
        guard let r = object["r"]?.intValue,
              let g = object["g"]?.intValue,
              let b = object["b"]?.intValue,
              (0 ... 255).contains(r),
              (0 ... 255).contains(g),
              (0 ... 255).contains(b) else {
            throw DictatorRPCError.invalidRequest("color r, g, and b must be 0...255")
        }
        return PadColor(r: UInt8(r), g: UInt8(g), b: UInt8(b))
    }
}

final class ExternalLaunchpadControlLayer: LaunchpadControlLayer {
    private let rpcService: DictatorRPCService

    init(rpcService: DictatorRPCService) {
        self.rpcService = rpcService
    }

    func handle(_ event: PadEvent) -> Bool {
        rpcService.handleLaunchpadEvent(event)
    }

    func getColor(at coordinate: PadCoordinate) -> PadColor? {
        rpcService.color(at: coordinate)
    }

    func allCoordinatesForRendering() -> [PadCoordinate] {
        rpcService.ownedCoordinates()
    }
}
