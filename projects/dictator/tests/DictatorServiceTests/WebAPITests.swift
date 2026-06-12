import Darwin
import DictatorCore
import Foundation
import XCTest
@testable import DictatorService

final class WebAPITests: XCTestCase
{
    private var server: DictationHTTPServer?
    private var port: Int = 0
    private var tempDir: URL?
    private var configURL: URL?
    private var safeConfigURL: URL?
    private var apiKeysURL: URL?
    private var runtimeConfigProvider: RuntimeConfigProvider?
    private var interactionStore: InteractionHistoryStore?
    private var vsCodeHunkRegistry: VSCodeHunkRegistry?
    private var fakeClient = WebAPITestFakeCoreClient()

    override func tearDown() async throws
    {
        URLProtocol.unregisterClass(WebAPIURLProtocolStub.self)
        if let server
        {
            await server.stop()
        }
        server = nil
        if let tempDir
        {
            try? FileManager.default.removeItem(at: tempDir)
        }
        try await super.tearDown()
    }

    func testIndexHTMLReturnsHTML() async throws
    {
        try await startServer()
        let (status, contentType, _) = try await rawRequest(method: "GET", path: "/")
        XCTAssertEqual(status, 200)
        XCTAssertTrue(contentType.contains("text/html"))
    }

    func testStaticAssetsReturnExpectedContentTypes() async throws
    {
        try await startServer()
        let js = try await rawRequest(method: "GET", path: "/assets/app.js")
        XCTAssertEqual(js.status, 200)
        XCTAssertTrue(js.contentType.contains("javascript"))

        let css = try await rawRequest(method: "GET", path: "/assets/styles.css")
        XCTAssertEqual(css.status, 200)
        XCTAssertTrue(css.contentType.contains("text/css"))
    }

    func testAppJSReferencesOnlyImplementedAPIs() async throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let appJS = try String(
            contentsOf: repoRoot
                .appendingPathComponent("projects/dictator/src/web/app.js"),
            encoding: .utf8
        )
        let allowed = [
            "/api/status",
            "/api/config",
            "/api/config/reset",
            "/api/config/options",
            "/api/prompts",
            "/api/prompts/preview",
            "/api/prompts/selection",
            "/api/interactions",
            "/v1/dictate-audio"
        ]
        let pattern = try NSRegularExpression(pattern: #"/api/[a-z0-9_./?=-]+"#)
        let range = NSRange(appJS.startIndex..<appJS.endIndex, in: appJS)
        let matches = pattern.matches(in: appJS, range: range)
        for match in matches
        {
            guard let matchRange = Range(match.range, in: appJS) else { continue }
            let path = String(appJS[matchRange])
            let allowedMatch = allowed.contains { path.hasPrefix($0) || path.contains($0) }
            XCTAssertTrue(allowedMatch, "Unexpected API reference in app.js: \(path)")
        }
    }

    func testStatusPayloadIncludesExpectedFieldsAndHidesSecrets() async throws
    {
        try await startServer(hasOpenAIKey: true)
        let (status, body) = try await jsonRequest(method: "GET", path: "/api/status")
        XCTAssertEqual(status, 200)
        XCTAssertEqual(body["healthy"] as? Bool, true)
        XCTAssertNotNil(body["uptime"])
        XCTAssertNotNil(body["dictation_state"])
        XCTAssertNotNil(body["provider_mode"])
        XCTAssertNotNil(body["cloud_model"])
        XCTAssertNotNil(body["local_model"])
        XCTAssertNotNil(body["log_path"])
        XCTAssertNotNil(body["data_path"])
        let apiKeys = body["api_keys"] as? [String: Any]
        XCTAssertNotNil(apiKeys?["openai_configured"])
        XCTAssertNil(body["openai_api_key"])
        let encoded = try JSONSerialization.data(withJSONObject: body)
        let encodedString = String(data: encoded, encoding: .utf8) ?? ""
        XCTAssertFalse(encodedString.contains("sk-"))
    }

    func testConfigPatchPersistsToDictatorJSON() async throws
    {
        try await startServer()
        let patch = #"{"use_cloud":true,"cloud_model":"gpt-5.2"}"#.data(using: .utf8)!
        let (status, _) = try await jsonRequest(method: "PATCH", path: "/api/config", body: patch, contentType: "application/json")
        XCTAssertEqual(status, 200)

        let configURL = try XCTUnwrap(configURL)
        let saved = try JSONDecoder().decode(RuntimeConfigFile.self, from: Data(contentsOf: configURL))
        XCTAssertTrue(saved.useCloud)
        XCTAssertEqual(saved.cloudModel, "gpt-5.2")
    }

    func testInvalidConfigPatchFailsClearly() async throws
    {
        try await startServer()
        let patch = #"{"cloud_model":""}"#.data(using: .utf8)!
        let (status, body) = try await jsonRequest(method: "PATCH", path: "/api/config", body: patch, contentType: "application/json")
        XCTAssertEqual(status, 400)
        XCTAssertNotNil(body["error"] as? String)
    }

    func testConfigResetRestoresDefaults() async throws
    {
        try await startServer()
        let patch = #"{"use_cloud":true}"#.data(using: .utf8)!
        _ = try await jsonRequest(method: "PATCH", path: "/api/config", body: patch, contentType: "application/json")

        let (status, _) = try await jsonRequest(method: "POST", path: "/api/config/reset")
        XCTAssertEqual(status, 200)

        let configURL = try XCTUnwrap(configURL)
        let saved = try JSONDecoder().decode(RuntimeConfigFile.self, from: Data(contentsOf: configURL))
        XCTAssertFalse(saved.useCloud)
    }

    func testPromptListAndPreviewRejectPathTraversal() async throws
    {
        try await startServer()
        let (listStatus, listBody) = try await jsonRequest(method: "GET", path: "/api/prompts?dir=..")
        XCTAssertEqual(listStatus, 400)
        XCTAssertNotNil(listBody["error"] as? String)

        let (previewStatus, previewBody) = try await jsonRequest(
            method: "GET",
            path: "/api/prompts/preview?path=../secrets.txt"
        )
        XCTAssertEqual(previewStatus, 400)
        XCTAssertNotNil(previewBody["error"] as? String)
    }

    func testPromptSelectionPersistsPrimaryAndAuxiliaryPaths() async throws
    {
        try await startServer()
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let promptsDir = repoRoot.appendingPathComponent("projects/dictator/src/prompts/system-prompts", isDirectory: true)
        let files = try FileManager.default.contentsOfDirectory(at: promptsDir, includingPropertiesForKeys: nil)
        let promptFile = files.first { $0.pathExtension == "md" }?.lastPathComponent
        let promptPath = try XCTUnwrap(promptFile)

        let primary = #"{"target":"primary","path":"\#(promptPath)"}"#.data(using: .utf8)!
        let (primaryStatus, _) = try await jsonRequest(
            method: "POST",
            path: "/api/prompts/selection",
            body: primary,
            contentType: "application/json"
        )
        XCTAssertEqual(primaryStatus, 200)

        let configURL = try XCTUnwrap(configURL)
        var saved = try JSONDecoder().decode(RuntimeConfigFile.self, from: Data(contentsOf: configURL))
        XCTAssertEqual(saved.systemPrompt, promptPath)

        let auxiliary = #"{"target":"auxiliary1","path":"\#(promptPath)"}"#.data(using: .utf8)!
        let (auxStatus, _) = try await jsonRequest(
            method: "POST",
            path: "/api/prompts/selection",
            body: auxiliary,
            contentType: "application/json"
        )
        XCTAssertEqual(auxStatus, 200)
        saved = try JSONDecoder().decode(RuntimeConfigFile.self, from: Data(contentsOf: configURL))
        XCTAssertEqual(saved.auxiliarySystemPrompt1, promptPath)
    }

    func testInteractionsListAndDetailReadPersistedRecords() async throws
    {
        try await startServer()
        let store = try XCTUnwrap(interactionStore)
        let interaction = DictationInteraction(
            occurredAt: Date(),
            whisperOutput: "hello",
            finalOutput: "Hello.",
            mode: .revision,
            systemPromptPath: "intent_refiner_v1.md",
            systemPromptBody: "prompt",
            model: "qwen2.5:7b-instruct",
            provider: "ollama",
            optionalContext: ["app": "test"],
            editSummary: "capitalized",
            uncertaintyFlags: [],
            timings: DictationInteractionTimings(transcribeMs: 1, refineMs: 2, insertMs: 0, totalPipelineMs: 3)
        )
        await store.append(interaction)

        let (listStatus, listBody) = try await jsonRequest(method: "GET", path: "/api/interactions")
        XCTAssertEqual(listStatus, 200)
        let interactions = listBody["interactions"] as? [[String: Any]]
        XCTAssertEqual(interactions?.first?["id"] as? String, interaction.id.uuidString)

        let (detailStatus, detailBody) = try await jsonRequest(
            method: "GET",
            path: "/api/interactions/\(interaction.id.uuidString)"
        )
        XCTAssertEqual(detailStatus, 200)
        XCTAssertEqual(detailBody["final_output"] as? String, "Hello.")
        XCTAssertEqual(detailBody["whisper_output"] as? String, "hello")
    }

    func testModelListingHandlesUnavailableOllama() async throws
    {
        try await startServer(ollamaAvailable: false)
        let (status, body) = try await jsonRequest(method: "GET", path: "/api/models?provider=local")
        XCTAssertEqual(status, 200)
        XCTAssertEqual(body["provider"] as? String, "local")
        XCTAssertNotNil(body["warning"] as? String)
        let models = body["models"] as? [String]
        XCTAssertEqual(models?.isEmpty, true)
    }

    func testCloudModelListingReturnsPresets() async throws
    {
        try await startServer()
        let (status, body) = try await jsonRequest(method: "GET", path: "/api/models?provider=cloud")
        XCTAssertEqual(status, 200)
        let models = body["models"] as? [String]
        XCTAssertTrue(models?.contains("gpt-4.1-mini") == true)
    }

    func testAPIKeyStatusNeverReturnsKeyMaterial() async throws
    {
        try await startServer(hasOpenAIKey: true)
        let (status, body) = try await jsonRequest(method: "GET", path: "/api/api-key-status")
        XCTAssertEqual(status, 200)
        let openai = body["openai"] as? [String: Any]
        XCTAssertEqual(openai?["configured"] as? Bool, true)
        XCTAssertNil(openai?["key"])
        let encoded = try JSONSerialization.data(withJSONObject: body)
        XCTAssertFalse(String(data: encoded, encoding: .utf8)?.contains("sk-test") == true)
    }

    func testVSCodeHunkStateAndCommandAPIRoundTrip() async throws
    {
        try await startServer()
        let snapshot = """
        {
          "windowId": "window-1",
          "focused": true,
          "paneOpen": true,
          "repoRoot": "/tmp/repo",
          "file": "Sources/App.swift",
          "fileIndex": 0,
          "fileCount": 1,
          "hunkIndex": 0,
          "hunkCount": 2,
          "currentHunk": {
            "id": "Sources/App.swift:0:abc",
            "file": "Sources/App.swift",
            "index": 0,
            "count": 2,
            "header": "@@ -1 +1 @@",
            "patchHash": "abc"
          },
          "actions": {
            "canGoUp": false,
            "canGoDown": true,
            "canGoPrevFile": false,
            "canGoNextFile": false,
            "canStage": true,
            "canRevert": true,
            "canUndo": false
          }
        }
        """.data(using: .utf8)!

        let (stateStatus, stateBody) = try await jsonRequest(
            method: "POST",
            path: "/api/vscode-hunk/state",
            body: snapshot,
            contentType: "application/json"
        )
        XCTAssertEqual(stateStatus, 200)
        XCTAssertEqual(stateBody["ok"] as? Bool, true)

        let registry = try XCTUnwrap(vsCodeHunkRegistry)
        let queued = registry.enqueueCommand(.stage)
        XCTAssertNotNil(queued)

        let commandResponse = try await rawRequest(method: "GET", path: "/api/vscode-hunk/command?window_id=window-1")
        XCTAssertEqual(commandResponse.status, 200)
        let command = try JSONDecoder().decode(VSCodeHunkCommandEnvelope.self, from: commandResponse.body)
        XCTAssertEqual(command.action, .stage)
        XCTAssertEqual(command.id, queued?.id)

        let result = """
        {
          "commandId": "\(command.id)",
          "windowId": "window-1",
          "result": {
            "ok": true,
            "action": "stage"
          }
        }
        """.data(using: .utf8)!
        let (resultStatus, resultBody) = try await jsonRequest(
            method: "POST",
            path: "/api/vscode-hunk/command-result",
            body: result,
            contentType: "application/json"
        )
        XCTAssertEqual(resultStatus, 200)
        XCTAssertEqual(resultBody["ok"] as? Bool, true)

        let diagnostics = try await rawRequest(method: "GET", path: "/api/vscode-hunk/diagnostics")
        XCTAssertEqual(diagnostics.status, 200)
        let decoded = try JSONDecoder().decode(VSCodeHunkDiagnostics.self, from: diagnostics.body)
        XCTAssertEqual(decoded.activeWindowId, "window-1")
        XCTAssertEqual(decoded.lastCommandResult, VSCodeHunkCommandResult(ok: true, action: .stage, error: nil))

        let disconnect = #"{"windowId":"window-1"}"#.data(using: .utf8)!
        let (disconnectStatus, disconnectBody) = try await jsonRequest(
            method: "POST",
            path: "/api/vscode-hunk/disconnect",
            body: disconnect,
            contentType: "application/json"
        )
        XCTAssertEqual(disconnectStatus, 200)
        XCTAssertEqual(disconnectBody["ok"] as? Bool, true)

        let afterDisconnect = try await rawRequest(method: "GET", path: "/api/vscode-hunk/diagnostics")
        let cleared = try JSONDecoder().decode(VSCodeHunkDiagnostics.self, from: afterDisconnect.body)
        XCTAssertNil(cleared.activeWindowId)
        XCTAssertEqual(cleared.instances.count, 0)
    }

    func testWebUIDoesNotReferenceRetiredNativeControls() throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let webDir = repoRoot.appendingPathComponent("projects/dictator/src/web")
        let forbidden = ["MenuBarController", "LaunchpadFullscreenOverlay", "promptForAPIKey", "onSetAPIKey"]
        let enumerator = FileManager.default.enumerator(at: webDir, includingPropertiesForKeys: nil)
        while let url = enumerator?.nextObject() as? URL
        {
            guard ["js", "html", "css"].contains(url.pathExtension) else { continue }
            let text = try String(contentsOf: url, encoding: .utf8)
            for token in forbidden
            {
                XCTAssertFalse(text.contains(token), "Found \(token) in \(url.lastPathComponent)")
            }
        }
    }

    private func startServer(hasOpenAIKey: Bool = false, ollamaAvailable: Bool = true) async throws
    {
        let repoRoot = try SheafRootDiscovery.requireRepoRoot()
        let tempDir = try makeTempDir()
        self.tempDir = tempDir

        let configURL = tempDir.appendingPathComponent("dictator.json")
        let safeConfigURL = tempDir.appendingPathComponent("dictator.safe")
        self.configURL = configURL
        self.safeConfigURL = safeConfigURL

        let defaults = RuntimeConfigFile.bootstrap()
        try RuntimeConfigStore(fileURL: safeConfigURL).save(defaults)
        try RuntimeConfigStore(fileURL: configURL).save(defaults)

        let apiKeysURL = tempDir.appendingPathComponent("api_keys.json")
        self.apiKeysURL = apiKeysURL
        if hasOpenAIKey
        {
            let payload = #"{"openai_api_key":"sk-test-not-real","omlx_api_key":"shared-test-key"}"#
            try payload.write(to: apiKeysURL, atomically: true, encoding: .utf8)
        }

        let provider = RuntimeConfigProvider(
            store: RuntimeConfigStore(fileURL: configURL),
            defaultStore: RuntimeConfigStore(fileURL: safeConfigURL)
        )
        runtimeConfigProvider = provider

        let buffer = DictationInteractionBuffer(maxBytes: 1024 * 1024)
        let store = InteractionHistoryStore(
            buffer: buffer,
            dataDirectoryURL: tempDir.appendingPathComponent("data", isDirectory: true),
            initialLoadBytes: 1024 * 1024
        )
        await store.startInitialLoadIfNeeded()
        await store.waitUntilReady()
        interactionStore = store

        if ollamaAvailable
        {
            WebAPIURLProtocolStub.handler = { request in
                let data = #"{"models":[{"name":"qwen2.5:7b-instruct"}]}"#.data(using: .utf8)!
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
            }
        }
        else
        {
            WebAPIURLProtocolStub.handler = { request in
                throw URLError(.cannotConnectToHost)
            }
        }
        URLProtocol.registerClass(WebAPIURLProtocolStub.self)
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [WebAPIURLProtocolStub.self]
        let session = URLSession(configuration: sessionConfig)

        let lifecycle = ServiceLifecycle()
        let activityTracker = DictationActivityTracker()
        let vsCodeHunkRegistry = VSCodeHunkRegistry()
        self.vsCodeHunkRegistry = vsCodeHunkRegistry

        let webContext = WebServiceContext(
            repoRoot: repoRoot,
            runtimeConfigProvider: provider,
            secretStore: APIKeysStore(fileURL: apiKeysURL),
            interactionStore: store,
            lifecycle: lifecycle,
            activityTracker: activityTracker,
            endpointDescription: "http://127.0.0.1:0",
            logPath: tempDir.appendingPathComponent("logs").path,
            dataPath: tempDir.appendingPathComponent("data").path,
            vsCodeHunkRegistry: vsCodeHunkRegistry
        )
        let webAPIService = WebAPIService(context: webContext, urlSession: session)
        await webAPIService.prepare()

        port = try allocatePort()
        let server = DictationHTTPServer(
            host: "127.0.0.1",
            port: port,
            lifecycle: lifecycle,
            coreClient: fakeClient,
            webAPIService: webAPIService,
            activityTracker: activityTracker
        )
        try await server.start()
        if let bound = server.boundPort
        {
            port = bound
        }
        self.server = server
        try await Task.sleep(nanoseconds: 50_000_000)
    }

    private func jsonRequest(
        method: String,
        path: String,
        body: Data = Data(),
        contentType: String? = nil
    ) async throws -> (Int, [String: Any])
    {
        let raw = try await rawRequest(method: method, path: path, body: body, contentType: contentType)
        let object = (try? JSONSerialization.jsonObject(with: raw.body)) as? [String: Any] ?? [:]
        return (raw.status, object)
    }

    private func rawRequest(
        method: String,
        path: String,
        body: Data = Data(),
        contentType: String? = nil
    ) async throws -> (status: Int, contentType: String, body: Data)
    {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
        request.httpMethod = method
        request.httpBody = body
        if let contentType
        {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let contentType = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
        return (status, contentType, data)
    }

    private func makeTempDir() throws -> URL
    {
        let base = FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func allocatePort() throws -> Int
    {
        let socket = socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else { throw NSError(domain: "WebAPITests", code: 1) }
        defer { close(socket) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bindResult = withUnsafePointer(to: &addr)
        { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1)
            { sockaddrPointer in
                Darwin.bind(socket, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else { throw NSError(domain: "WebAPITests", code: 2) }

        var bound = sockaddr_in()
        var boundLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &bound)
        { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1)
            { sockaddrPointer in
                getsockname(socket, sockaddrPointer, &boundLength)
            }
        }
        guard nameResult == 0 else { throw NSError(domain: "WebAPITests", code: 3) }
        return Int(UInt16(bigEndian: bound.sin_port))
    }
}

private final class WebAPIURLProtocolStub: URLProtocol
{
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool
    {
        request.url?.absoluteString.contains("/api/tags") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest
    {
        request
    }

    override func startLoading()
    {
        guard let handler = Self.handler else
        {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do
        {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
        catch
        {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private actor WebAPITestFakeCoreClient: DictatorCoreClient
{
    func transcribe(_ request: TranscribeRequest) async throws -> TranscribeResponse
    {
        TranscribeResponse(raw_transcript: "", segments: [], confidence: 0, duration_ms: 0)
    }

    func refine(_ request: RefineRequest) async throws -> RefineResponse
    {
        RefineResponse(revised_text: "", edit_summary: "", uncertainty_flags: [])
    }

    func dictate(_ request: DictateRequest) async throws -> DictateCallResult
    {
        DictateCallResult(
            response: DictateResponse(
                raw_transcript: "",
                revised_text: "",
                edit_summary: "",
                uncertainty_flags: []
            ),
            transcribeMs: 0,
            refineMs: 0
        )
    }

    func interactForRuntimeConfig(_ request: VoiceConfigInteractionRequest) async throws -> VoiceConfigInteractionResult
    {
        throw DictatorError.configInteractionUnavailable
    }
}
