import DictatorCore
import Foundation

struct WebServiceContext: Sendable
{
    let repoRoot: URL
    let runtimeConfigProvider: RuntimeConfigProvider
    let secretStore: APIKeysStore
    let interactionStore: InteractionHistoryStore
    let lifecycle: ServiceLifecycle
    let activityTracker: DictationActivityTracker
    let endpointDescription: String
    let logPath: String
    let dataPath: String
    let vsCodeHunkRegistry: VSCodeHunkRegistry
}

actor WebAPIService
{
    private let context: WebServiceContext
    private var configurationManager: RuntimeConfigurationManager
    private let urlSession: URLSession

    init(context: WebServiceContext, urlSession: URLSession = .shared)
    {
        self.context = context
        self.urlSession = urlSession
        self.configurationManager = RuntimeConfigurationManager(configurations: [])
    }

    func prepare() async
    {
        let config = await context.runtimeConfigProvider.currentRuntimeConfig()
        let promptCatalog = SystemPromptCatalog(
            directoryURL: config.resolvedSystemPromptsDirectoryURL(currentDirectoryPath: context.repoRoot.path)
        )
        configurationManager = await WebServiceFactory.makeConfigurationManager(
            runtimeConfigProvider: context.runtimeConfigProvider,
            secretStore: context.secretStore,
            promptCatalog: promptCatalog,
            onBufferBytesUpdated: { [interactionStore = context.interactionStore] bytes in
                Task
                {
                    await interactionStore.setMaxBytes(bytes)
                }
            }
        )
    }

    func handle(route: WebRoute, body: Data) async throws -> WebAPIResult
    {
        switch route
        {
        case .indexHTML:
            return try staticAsset(path: "index.html")
        case let .staticAsset(path):
            return try staticAsset(path: path)
        case .apiStatus:
            return try await .json(status())
        case .apiConfig:
            return try await .json(configSnapshot())
        case .apiConfigPatch:
            return try await .json(try await applyConfigPatch(body: body))
        case .apiConfigReset:
            return try await .json(try await resetConfig())
        case let .apiConfigOptions(fieldName):
            return try await .json(try await configOptions(fieldName: fieldName))
        case let .apiPrompts(directory):
            return try await .json(try await promptList(directory: directory))
        case let .apiPromptPreview(path):
            return try await .json(try await promptPreview(path: path))
        case .apiPromptSelection:
            return try await .json(try await applyPromptSelection(body: body))
        case .apiInteractions:
            return try await .json(await interactionList())
        case let .apiInteractionDetail(id):
            return try await .json(try await interactionDetail(id: id))
        case let .apiModels(provider):
            return try await .json(try await modelList(provider: provider))
        case .apiKeyStatus:
            return try await .json(apiKeyStatus())
        case .apiVSCodeHunkState:
            return try .json(updateVSCodeHunkState(body: body))
        case .apiVSCodeHunkHeartbeat:
            return try .json(updateVSCodeHunkHeartbeat(body: body))
        case .apiVSCodeHunkDisconnect:
            return try .json(disconnectVSCodeHunkClient(body: body))
        case let .apiVSCodeHunkCommand(windowID):
            return .json(context.vsCodeHunkRegistry.nextCommand(windowId: windowID))
        case .apiVSCodeHunkCommandResult:
            return try .json(recordVSCodeHunkCommandResult(body: body))
        case .apiVSCodeHunkDiagnostics:
            return .json(context.vsCodeHunkRegistry.diagnostics())
        }
    }

    private func staticAsset(path: String) throws -> WebAPIResult
    {
        let asset = try StaticAssets.load(repoRoot: context.repoRoot, assetPath: path)
        return .bytes(contentType: asset.contentType, body: asset.body)
    }

    private func status() async throws -> WebAPIJSON.StatusResponse
    {
        let config = await context.runtimeConfigProvider.currentRuntimeConfig()
        let repoPath = context.repoRoot.path
        let sttPath = config.resolvedSTTModelPath(currentDirectoryPath: repoPath)
        let sttPresent = FileManager.default.fileExists(atPath: sttPath)
        let openAIConfigured = (try? context.secretStore.getOpenAIKey()) != nil
        let ollamaStatus = await checkOllamaReachability(host: config.ollamaHost)
        let dictationState = await context.activityTracker.currentState().rawValue
        let providerMode = config.useCloud ? "cloud" : "local"

        return WebAPIJSON.StatusResponse(
            healthy: true,
            uptime: context.lifecycle.UptimeSeconds(),
            warning: context.lifecycle.healthWarning,
            dictation_state: dictationState,
            provider_mode: providerMode,
            use_cloud: config.useCloud,
            fallback_mode: config.fallbackMode,
            cloud_model: config.cloudModel,
            local_model: config.localModel,
            system_prompt: config.systemPrompt,
            auxiliary_system_prompt_1: config.auxiliarySystemPrompt1,
            auxiliary_system_prompt_2: config.auxiliarySystemPrompt2,
            api_keys: WebAPIJSON.APIKeyFlags(openai_configured: openAIConfigured),
            stt_model_present: sttPresent,
            stt_model_path: sttPath,
            ollama_reachable: ollamaStatus.reachable,
            ollama_warning: ollamaStatus.warning,
            log_path: context.logPath,
            data_path: context.dataPath,
            dictate_endpoint: "POST \(context.endpointDescription)/v1/dictate-audio",
            health_endpoint: "GET \(context.endpointDescription)/health"
        )
    }

    private func configSnapshot() async throws -> WebAPIJSON.ConfigResponse
    {
        let config = await context.runtimeConfigProvider.currentRuntimeConfig()
        let defaults = await context.runtimeConfigProvider.startupDefaultConfig()
        let snapshots = try await configurationManager.list()

        var fields: [WebAPIJSON.ConfigField] = []
        for fieldName in WebConfigFieldMapping.editableFields.sorted()
        {
            guard let managerName = WebConfigFieldMapping.managerName(for: fieldName) else
            {
                continue
            }
            let snapshot = snapshots.first { $0.name == managerName }
            let current = snapshot?.currentValue ?? currentValue(for: fieldName, config: config)
            let defaultValue = snapshot?.defaultValue ?? currentValue(for: fieldName, config: defaults)
            fields.append(
                WebAPIJSON.ConfigField(
                    name: fieldName,
                    label: WebConfigFieldMapping.labelByField[fieldName] ?? fieldName,
                    type: valueKind(current),
                    editable: true,
                    current: encodeValue(current),
                    default: encodeValue(defaultValue)
                )
            )
        }

        return WebAPIJSON.ConfigResponse(fields: fields, updated_at: config.updatedAt)
    }

    private func applyConfigPatch(body: Data) async throws -> WebAPIJSON.ConfigResponse
    {
        let request = try JSONDecoder().decode(WebAPIJSON.ConfigPatchRequest.self, from: body)

        if let useCloud = request.use_cloud
        {
            try await setField(WebConfigFieldMapping.useCloud, value: .bool(useCloud))
        }
        if let cloudModel = request.cloud_model
        {
            try await setField(WebConfigFieldMapping.cloudModel, value: .string(cloudModel))
        }
        if let localModel = request.local_model
        {
            try await setField(WebConfigFieldMapping.localModel, value: .string(localModel))
        }
        if let systemPrompt = request.system_prompt
        {
            try await setField(WebConfigFieldMapping.systemPrompt, value: .string(systemPrompt))
        }
        if let auxiliary1 = request.auxiliary_system_prompt_1
        {
            try await setField(WebConfigFieldMapping.auxiliarySystemPrompt1, value: .string(auxiliary1))
        }
        if let auxiliary2 = request.auxiliary_system_prompt_2
        {
            try await setField(WebConfigFieldMapping.auxiliarySystemPrompt2, value: .string(auxiliary2))
        }
        if let bufferBytes = request.interactions_buffer_bytes
        {
            let megabytes = max(1, bufferBytes / (1024 * 1024))
            try await setField(
                WebConfigFieldMapping.interactionsBufferBytes,
                value: .string("\(megabytes) MB")
            )
        }

        let hasPatch = request.use_cloud != nil
            || request.cloud_model != nil
            || request.local_model != nil
            || request.system_prompt != nil
            || request.auxiliary_system_prompt_1 != nil
            || request.auxiliary_system_prompt_2 != nil
            || request.interactions_buffer_bytes != nil
        guard hasPatch else
        {
            throw DictatorError.configUpdateFailed("config patch must include at least one field")
        }

        try await context.runtimeConfigProvider.persistCurrentToDisk()
        return try await configSnapshot()
    }

    private func resetConfig() async throws -> WebAPIJSON.ConfigResponse
    {
        let restored = try await context.runtimeConfigProvider.restoreDefaultsToDisk()
        await context.interactionStore.setMaxBytes(restored.interactionsBufferBytes)
        await prepare()
        return try await configSnapshot()
    }

    private func configOptions(fieldName: String) async throws -> WebAPIJSON.ConfigOptionsResponse
    {
        guard let managerName = WebConfigFieldMapping.managerName(for: fieldName) else
        {
            throw DictatorError.configUpdateFailed("unknown config field: \(fieldName)")
        }
        let options = try await configurationManager.getOptions(name: managerName)
        return WebAPIJSON.ConfigOptionsResponse(
            name: fieldName,
            options: options.map(encodeValue)
        )
    }

    private func promptList(directory: String) async throws -> WebAPIJSON.PromptListResponse
    {
        let config = await context.runtimeConfigProvider.currentRuntimeConfig()
        let catalog = SystemPromptCatalog(
            directoryURL: config.resolvedSystemPromptsDirectoryURL(currentDirectoryPath: context.repoRoot.path)
        )
        let entries = try catalog.listEntries(in: directory).map
        { entry in
            WebAPIJSON.PromptEntry(
                name: entry.name,
                path: entry.relativePath,
                kind: entry.kind == .directory ? "directory" : "file"
            )
        }
        return WebAPIJSON.PromptListResponse(directory: directory, entries: entries)
    }

    private func promptPreview(path: String) async throws -> WebAPIJSON.PromptPreviewResponse
    {
        let config = await context.runtimeConfigProvider.currentRuntimeConfig()
        let catalog = SystemPromptCatalog(
            directoryURL: config.resolvedSystemPromptsDirectoryURL(currentDirectoryPath: context.repoRoot.path)
        )
        let body = try catalog.loadPrompt(named: path)
        return WebAPIJSON.PromptPreviewResponse(
            path: catalog.sanitizeRelativePath(path),
            body: body,
            byte_count: body.utf8.count
        )
    }

    private func applyPromptSelection(body: Data) async throws -> WebAPIJSON.ConfigResponse
    {
        let request = try JSONDecoder().decode(WebAPIJSON.PromptSelectionRequest.self, from: body)
        let config = await context.runtimeConfigProvider.currentRuntimeConfig()
        let catalog = SystemPromptCatalog(
            directoryURL: config.resolvedSystemPromptsDirectoryURL(currentDirectoryPath: context.repoRoot.path)
        )
        let sanitized = catalog.sanitizeRelativePath(request.path)
        let available = try catalog.listPromptFiles()
        guard available.contains(sanitized) else
        {
            throw DictatorError.configUpdateFailed("unknown system prompt path: \(sanitized)")
        }

        let patch: RuntimeConfigPatch
        switch request.target.lowercased()
        {
        case "primary":
            patch = RuntimeConfigPatch(systemPrompt: sanitized)
        case "auxiliary1":
            patch = RuntimeConfigPatch(auxiliarySystemPrompt1: sanitized)
        case "auxiliary2":
            patch = RuntimeConfigPatch(auxiliarySystemPrompt2: sanitized)
        default:
            throw DictatorError.configUpdateFailed("target must be primary, auxiliary1, or auxiliary2")
        }

        _ = try await context.runtimeConfigProvider.applyPatch(patch)
        await prepare()
        return try await configSnapshot()
    }

    private func interactionList() async -> WebAPIJSON.InteractionListResponse
    {
        let interactions = await context.interactionStore.listInteractionsNewestFirst()
        return WebAPIJSON.InteractionListResponse(
            interactions: interactions.map(interactionSummary)
        )
    }

    private func interactionDetail(id: String) async throws -> WebAPIJSON.InteractionDetailResponse
    {
        guard let uuid = UUID(uuidString: id) else
        {
            throw WebRouterError.badRequest("invalid interaction id")
        }
        guard let interaction = await context.interactionStore.interaction(id: uuid) else
        {
            throw WebRouterError.notFound
        }
        return interactionDetailResponse(interaction)
    }

    private func modelList(provider: String) async throws -> WebAPIJSON.ModelsResponse
    {
        let normalized = provider.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch normalized
        {
        case "cloud":
            return WebAPIJSON.ModelsResponse(
                provider: "cloud",
                models: ["gpt-4.1-mini", "gpt-5.2"],
                warning: nil
            )
        case "local":
            let config = await context.runtimeConfigProvider.currentRuntimeConfig()
            do
            {
                let models = try await fetchOllamaModels(host: config.ollamaHost)
                return WebAPIJSON.ModelsResponse(provider: "local", models: models, warning: nil)
            }
            catch
            {
                return WebAPIJSON.ModelsResponse(
                    provider: "local",
                    models: [],
                    warning: error.localizedDescription
                )
            }
        default:
            throw DictatorError.configUpdateFailed("provider must be cloud or local")
        }
    }

    private func apiKeyStatus() async throws -> WebAPIJSON.APIKeyStatusResponse
    {
        let configured = (try? context.secretStore.getOpenAIKey()) != nil
        return WebAPIJSON.APIKeyStatusResponse(
            openai: WebAPIJSON.APIKeyProviderStatus(configured: configured)
        )
    }

    private func updateVSCodeHunkState(body: Data) throws -> WebAPIJSON.AcceptedResponse
    {
        let snapshot = try JSONDecoder().decode(VSCodeHunkPaneSnapshot.self, from: body)
        context.vsCodeHunkRegistry.update(snapshot: snapshot)
        return WebAPIJSON.AcceptedResponse(ok: true)
    }

    private func updateVSCodeHunkHeartbeat(body: Data) throws -> WebAPIJSON.AcceptedResponse
    {
        let request = try JSONDecoder().decode(VSCodeHunkHeartbeatRequest.self, from: body)
        context.vsCodeHunkRegistry.heartbeat(windowId: request.windowId, focused: request.focused)
        return WebAPIJSON.AcceptedResponse(ok: true)
    }

    private func disconnectVSCodeHunkClient(body: Data) throws -> WebAPIJSON.AcceptedResponse
    {
        let request = try JSONDecoder().decode(VSCodeHunkDisconnectRequest.self, from: body)
        context.vsCodeHunkRegistry.disconnect(windowId: request.windowId)
        return WebAPIJSON.AcceptedResponse(ok: true)
    }

    private func recordVSCodeHunkCommandResult(body: Data) throws -> WebAPIJSON.AcceptedResponse
    {
        let request = try JSONDecoder().decode(VSCodeHunkCommandResultRequest.self, from: body)
        context.vsCodeHunkRegistry.recordResult(request.result)
        return WebAPIJSON.AcceptedResponse(ok: true)
    }

    private func setField(_ fieldName: String, value: RuntimeConfigurationValue) async throws
    {
        guard let managerName = WebConfigFieldMapping.managerName(for: fieldName) else
        {
            throw DictatorError.configUpdateFailed("unknown config field: \(fieldName)")
        }
        try await configurationManager.set(name: managerName, value: value)
    }

    private func currentValue(for fieldName: String, config: RuntimeConfigFile) -> RuntimeConfigurationValue
    {
        switch fieldName
        {
        case WebConfigFieldMapping.useCloud:
            return .bool(config.useCloud)
        case WebConfigFieldMapping.cloudModel:
            return .string(config.cloudModel)
        case WebConfigFieldMapping.localModel:
            return .string(config.localModel)
        case WebConfigFieldMapping.systemPrompt:
            return .string(config.systemPrompt)
        case WebConfigFieldMapping.auxiliarySystemPrompt1:
            return .string(config.auxiliarySystemPrompt1)
        case WebConfigFieldMapping.auxiliarySystemPrompt2:
            return .string(config.auxiliarySystemPrompt2)
        case WebConfigFieldMapping.interactionsBufferBytes:
            let megabytes = max(1, config.interactionsBufferBytes / (1024 * 1024))
            return .string("\(megabytes) MB")
        default:
            return .string("")
        }
    }

    private func encodeValue(_ value: RuntimeConfigurationValue) -> WebAPIJSON.ConfigValue
    {
        switch value
        {
        case let .string(stringValue):
            return WebAPIJSON.ConfigValue(kind: "string", value: stringValue)
        case let .bool(boolValue):
            return WebAPIJSON.ConfigValue(kind: "bool", value: boolValue ? "true" : "false")
        }
    }

    private func valueKind(_ value: RuntimeConfigurationValue) -> String
    {
        switch value
        {
        case .string:
            return "string"
        case .bool:
            return "bool"
        }
    }

    private func interactionSummary(_ interaction: DictationInteraction) -> WebAPIJSON.InteractionSummary
    {
        let status = interaction.errorMessage == nil ? "success" : "error"
        return WebAPIJSON.InteractionSummary(
            id: interaction.id.uuidString,
            occurred_at: isoTimestamp(interaction.occurredAt),
            source: interaction.mode.rawValue,
            status: status,
            provider: interaction.provider,
            model: interaction.model,
            transcribe_ms: interaction.timings.transcribeMs,
            refine_ms: interaction.timings.refineMs,
            total_pipeline_ms: interaction.timings.totalPipelineMs,
            output_preview: preview(interaction.finalOutput),
            error_preview: interaction.errorMessage.map { preview($0) }
        )
    }

    private func interactionDetailResponse(_ interaction: DictationInteraction) -> WebAPIJSON.InteractionDetailResponse
    {
        WebAPIJSON.InteractionDetailResponse(
            id: interaction.id.uuidString,
            occurred_at: isoTimestamp(interaction.occurredAt),
            source: interaction.mode.rawValue,
            status: interaction.errorMessage == nil ? "success" : "error",
            provider: interaction.provider,
            model: interaction.model,
            system_prompt_path: interaction.systemPromptPath,
            system_prompt_body: interaction.systemPromptBody,
            whisper_output: interaction.whisperOutput,
            final_output: interaction.finalOutput,
            optional_context: interaction.optionalContext,
            edit_summary: interaction.editSummary,
            uncertainty_flags: interaction.uncertaintyFlags,
            fallback_used: interaction.fallbackUsed,
            error_message: interaction.errorMessage,
            timings: WebAPIJSON.InteractionTimings(
                transcribe_ms: interaction.timings.transcribeMs,
                refine_ms: interaction.timings.refineMs,
                insert_ms: interaction.timings.insertMs,
                total_pipeline_ms: interaction.timings.totalPipelineMs
            )
        )
    }

    private func preview(_ value: String, limit: Int = 160) -> String
    {
        if value.count <= limit
        {
            return value
        }
        let index = value.index(value.startIndex, offsetBy: limit)
        return String(value[..<index]) + "…"
    }

    private func isoTimestamp(_ date: Date) -> String
    {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func checkOllamaReachability(host: String) async -> (reachable: Bool?, warning: String?)
    {
        guard let url = URL(string: "\(host)/api/tags") else
        {
            return (false, "invalid Ollama host")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 2

        do
        {
            let (_, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else
            {
                return (false, "invalid Ollama response")
            }
            if (200 ... 299).contains(http.statusCode)
            {
                return (true, nil)
            }
            return (false, "Ollama returned HTTP \(http.statusCode)")
        }
        catch
        {
            return (false, "Ollama unreachable: \(error.localizedDescription)")
        }
    }

    private func fetchOllamaModels(host: String) async throws -> [String]
    {
        guard let url = URL(string: "\(host)/api/tags") else
        {
            throw DictatorError.configUpdateFailed("invalid Ollama host")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 5
        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else
        {
            throw DictatorError.configUpdateFailed("Ollama model list failed")
        }
        struct TagsResponse: Decodable
        {
            struct Model: Decodable
            {
                let name: String
            }
            let models: [Model]
        }
        let decoded = try JSONDecoder().decode(TagsResponse.self, from: data)
        return decoded.models.map(\.name)
    }
}

enum WebAPIResult
{
    case jsonPayload(EncodablePayload)
    case bytes(contentType: String, body: Data)
}

struct EncodablePayload: Encodable
{
    private let encodeBody: (Encoder) throws -> Void

    init<T: Encodable>(_ value: T)
    {
        encodeBody = value.encode
    }

    func encode(to encoder: Encoder) throws
    {
        try encodeBody(encoder)
    }
}

extension WebAPIResult
{
    static func json<T: Encodable>(_ value: T) -> WebAPIResult
    {
        .jsonPayload(EncodablePayload(value))
    }
}
