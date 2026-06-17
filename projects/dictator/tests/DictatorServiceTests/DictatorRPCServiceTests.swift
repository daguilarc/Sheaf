import XCTest
import DictatorCore
import NIOHTTP1
@testable import DictatorService

final class DictatorRPCServiceTests: XCTestCase {
    func testUpgradeRequiresRPCPathAndClientIdentity() {
        XCTAssertEqual(
            DictatorRPCWebSocketUpgrade.clientID(from: HTTPRequestHead(version: .http1_1, method: .GET, uri: "/ws/rpc?client=sheaf-chat")),
            "sheaf-chat"
        )
        XCTAssertNil(DictatorRPCWebSocketUpgrade.clientID(from: HTTPRequestHead(version: .http1_1, method: .GET, uri: "/ws/rpc")))
        XCTAssertNil(DictatorRPCWebSocketUpgrade.clientID(from: HTTPRequestHead(version: .http1_1, method: .POST, uri: "/ws/rpc?client=sheaf-chat")))
        XCTAssertNil(DictatorRPCWebSocketUpgrade.clientID(from: HTTPRequestHead(version: .http1_1, method: .GET, uri: "/api/status?client=sheaf-chat")))
    }

    func testHelloPingUnsupportedMethodAndMalformedParams() throws {
        var events: [DictatorRPCEnvelope] = []
        let service = DictatorRPCService()
        let sessionID = service.registerClient(clientID: "client") { text in
            events.append(Self.decode(text))
        }

        XCTAssertEqual(events.first?.method, "rpc.hello")
        XCTAssertEqual(events.first?.params?.objectValue?["protocolVersion"], .number(1))

        let ping = try response(
            service.handleTextFrame(#"{"id":"1","method":"rpc.ping"}"#, sessionID: sessionID)
        )
        XCTAssertEqual(ping.id, "1")
        XCTAssertEqual(ping.result, .object(["ok": .bool(true)]))

        let unsupported = try response(
            service.handleTextFrame(#"{"id":"2","method":"missing.method"}"#, sessionID: sessionID)
        )
        XCTAssertEqual(unsupported.id, "2")
        XCTAssertEqual(unsupported.error?.code, "method_not_found")

        let malformedParams = try response(
            service.handleTextFrame(#"{"id":"3","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3}]}}"#, sessionID: sessionID)
        )
        XCTAssertEqual(malformedParams.id, "3")
        XCTAssertEqual(malformedParams.error?.code, "invalid_request")
    }

    func testCellOwnershipConflictLeavesExistingOwnerUntouched() throws {
        let service = DictatorRPCService()
        let first = service.registerClient(clientID: "first") { _ in }
        let second = service.registerClient(clientID: "second") { _ in }
        _ = service.handleTextFrame(
            #"{"id":"set","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3,"r":1,"g":2,"b":3}]}}"#,
            sessionID: first
        )

        let conflict = try response(
            service.handleTextFrame(
                #"{"id":"conflict","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3,"r":9,"g":9,"b":9}]}}"#,
                sessionID: second
            )
        )

        XCTAssertEqual(conflict.id, "conflict")
        XCTAssertEqual(conflict.error?.code, "conflict")
        XCTAssertEqual(service.color(at: PadCoordinate(x: 3, y: 3)), PadColor(r: 1, g: 2, b: 3))
    }

    func testInsertTextValidationAndErrors() throws {
        var inserted: [String] = []
        let service = DictatorRPCService { text in
            inserted.append(text)
            return text == "fail"
                ? .failure(.keyEventSynthesisFailed)
                : .success(())
        }
        let sessionID = service.registerClient(clientID: "client") { _ in }

        let ok = try response(
            service.handleTextFrame(#"{"id":"ok","method":"cursor.insertText","params":{"text":"review text"}}"#, sessionID: sessionID)
        )
        XCTAssertEqual(ok.result, .object(["ok": .bool(true)]))
        XCTAssertEqual(inserted, ["review text"])

        let empty = try response(
            service.handleTextFrame(#"{"id":"empty","method":"cursor.insertText","params":{"text":""}}"#, sessionID: sessionID)
        )
        XCTAssertEqual(empty.error?.code, "invalid_request")
        XCTAssertEqual(inserted, ["review text"])

        let tooLong = String(repeating: "x", count: 1024 * 1024 + 1)
        let tooLongRequest = DictatorRPCEnvelope(
            id: "long",
            method: "cursor.insertText",
            params: .object(["text": .string(tooLong)])
        )
        let tooLongResponse = try response(service.handleTextFrame(Self.encode(tooLongRequest), sessionID: sessionID))
        XCTAssertEqual(tooLongResponse.error?.code, "invalid_request")
        XCTAssertEqual(inserted, ["review text"])

        let failure = try response(
            service.handleTextFrame(#"{"id":"fail","method":"cursor.insertText","params":{"text":"fail"}}"#, sessionID: sessionID)
        )
        XCTAssertEqual(failure.error?.code, "insert_failed")
        XCTAssertEqual(inserted, ["review text", "fail"])
    }

    func testContextReplacementPopDisconnectAndTimeoutCleanup() throws {
        let service = DictatorRPCService(heartbeatTimeoutSeconds: 0.1)
        let sessionID = service.registerClient(clientID: "client") { _ in }
        _ = service.handleTextFrame(
            #"{"id":"push","method":"dictationContext.push","params":{"id":"hunk","title":"First","metadata":{"file":"a.ts"},"body":"old"}}"#,
            sessionID: sessionID
        )
        _ = service.handleTextFrame(
            #"{"id":"replace","method":"dictationContext.push","params":{"id":"hunk","title":"Second","body":"new"}}"#,
            sessionID: sessionID
        )

        XCTAssertEqual(service.activeContextBlocks().map(\.title), ["Second"])

        _ = service.handleTextFrame(
            #"{"id":"pop","method":"dictationContext.pop","params":{"id":"hunk"}}"#,
            sessionID: sessionID
        )
        XCTAssertTrue(service.activeContextBlocks().isEmpty)

        _ = service.handleTextFrame(
            #"{"id":"cell","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3,"r":1,"g":2,"b":3}]}}"#,
            sessionID: sessionID
        )
        _ = service.handleTextFrame(
            #"{"id":"ctx","method":"dictationContext.push","params":{"id":"hunk","title":"Focused","body":"patch"}}"#,
            sessionID: sessionID
        )
        service.cleanupExpiredSessions(now: Date().addingTimeInterval(1))

        XCTAssertNil(service.color(at: PadCoordinate(x: 3, y: 3)))
        XCTAssertTrue(service.activeContextBlocks().isEmpty)
        XCTAssertEqual(service.diagnostics(), DictatorRPCDiagnostic(connected_clients: 0, owned_cells: 0, pushed_context_blocks: 0))
    }

    func testPingRenewsLivenessWithoutMutatingOwnedState() throws {
        let service = DictatorRPCService(heartbeatTimeoutSeconds: 0.05) { text in
            XCTFail("rpc.ping must not insert text, got \(text)")
            return .success(())
        }
        let sessionID = service.registerClient(clientID: "client") { _ in }

        _ = service.handleTextFrame(
            #"{"id":"cell","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3,"r":1,"g":2,"b":3}]}}"#,
            sessionID: sessionID
        )
        _ = service.handleTextFrame(
            #"{"id":"ctx","method":"dictationContext.push","params":{"id":"hunk","title":"Focused","body":"patch"}}"#,
            sessionID: sessionID
        )

        Thread.sleep(forTimeInterval: 0.04)
        let ping = try response(
            service.handleTextFrame(#"{"id":"ping","method":"rpc.ping"}"#, sessionID: sessionID)
        )
        XCTAssertEqual(ping.id, "ping")
        XCTAssertEqual(ping.result, .object(["ok": .bool(true)]))

        service.cleanupExpiredSessions(now: Date().addingTimeInterval(0.04))

        XCTAssertEqual(service.color(at: PadCoordinate(x: 3, y: 3)), PadColor(r: 1, g: 2, b: 3))
        XCTAssertEqual(service.activeContextBlocks().map(\.title), ["Focused"])
        XCTAssertEqual(service.diagnostics(), DictatorRPCDiagnostic(connected_clients: 1, owned_cells: 1, pushed_context_blocks: 1))
    }

    func testDisconnectCleanup() {
        let service = DictatorRPCService()
        let sessionID = service.registerClient(clientID: "client") { _ in }
        _ = service.handleTextFrame(
            #"{"id":"cell","method":"launchpad.setCells","params":{"cells":[{"x":3,"y":3,"r":1,"g":2,"b":3}]}}"#,
            sessionID: sessionID
        )
        _ = service.handleTextFrame(
            #"{"id":"ctx","method":"dictationContext.push","params":{"id":"hunk","title":"Focused","body":"patch"}}"#,
            sessionID: sessionID
        )

        service.unregisterClient(sessionID: sessionID)

        XCTAssertNil(service.color(at: PadCoordinate(x: 3, y: 3)))
        XCTAssertTrue(service.activeContextBlocks().isEmpty)
    }

    private static func decode(_ text: String) -> DictatorRPCEnvelope {
        try! JSONDecoder().decode(DictatorRPCEnvelope.self, from: Data(text.utf8))
    }

    private static func encode(_ envelope: DictatorRPCEnvelope) throws -> String {
        String(data: try JSONEncoder().encode(envelope), encoding: .utf8)!
    }

    private func response(_ text: String?) throws -> DictatorRPCEnvelope {
        try JSONDecoder().decode(DictatorRPCEnvelope.self, from: Data(try XCTUnwrap(text).utf8))
    }
}
