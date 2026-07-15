import Foundation

struct WebAPIJSON
{
    struct ErrorResponse: Codable
    {
        let error: String
    }

    struct AcceptedResponse: Codable
    {
        let ok: Bool
    }

    struct StatusResponse: Codable
    {
        let healthy: Bool
        let uptime: Double
        let warning: String?
        let dictation_state: String
        let provider_mode: String
        let use_cloud: Bool
        let fallback_mode: String
        let cloud_model: String
        let local_model: String
        let audio_input: String
        let audio_input_effective: String
        let audio_input_mode: String
        let audio_input_available: Bool
        let audio_input_unavailable_reason: String
        let system_prompt: String
        let auxiliary_system_prompt_1: String
        let auxiliary_system_prompt_2: String
        let api_keys: APIKeyFlags
        let stt_model_present: Bool
        let stt_model_path: String
        let ollama_reachable: Bool?
        let ollama_warning: String?
        let log_path: String
        let data_path: String
        let dictate_endpoint: String
        let health_endpoint: String
    }

    struct APIKeyFlags: Codable
    {
        let openai_configured: Bool
    }

    struct ConfigValue: Codable, Equatable
    {
        let kind: String
        let value: String
    }

    struct ConfigField: Codable
    {
        let name: String
        let label: String
        let type: String
        let editable: Bool
        let current: ConfigValue
        let `default`: ConfigValue
    }

    struct ConfigResponse: Codable
    {
        let fields: [ConfigField]
        let updated_at: String
    }

    struct ConfigPatchRequest: Decodable
    {
        let use_cloud: Bool?
        let cloud_model: String?
        let local_model: String?
        let system_prompt: String?
        let auxiliary_system_prompt_1: String?
        let auxiliary_system_prompt_2: String?
        let interactions_buffer_bytes: Int?

        enum CodingKeys: String, CodingKey
        {
            case use_cloud
            case cloud_model
            case local_model
            case audio_input
            case system_prompt
            case auxiliary_system_prompt_1
            case auxiliary_system_prompt_2
            case interactions_buffer_bytes
        }

        let audio_input: String??

        init(from decoder: Decoder) throws
        {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            use_cloud = try container.decodeIfPresent(Bool.self, forKey: .use_cloud)
            cloud_model = try container.decodeIfPresent(String.self, forKey: .cloud_model)
            local_model = try container.decodeIfPresent(String.self, forKey: .local_model)
            system_prompt = try container.decodeIfPresent(String.self, forKey: .system_prompt)
            auxiliary_system_prompt_1 = try container.decodeIfPresent(
                String.self,
                forKey: .auxiliary_system_prompt_1
            )
            auxiliary_system_prompt_2 = try container.decodeIfPresent(
                String.self,
                forKey: .auxiliary_system_prompt_2
            )
            interactions_buffer_bytes = try container.decodeIfPresent(Int.self, forKey: .interactions_buffer_bytes)

            if container.contains(.audio_input)
            {
                audio_input = try container.decodeNil(forKey: .audio_input)
                    ? .some(nil)
                    : .some(container.decode(String.self, forKey: .audio_input))
            }
            else
            {
                audio_input = nil
            }
        }
    }

    struct ConfigOptionsResponse: Codable
    {
        let name: String
        let options: [ConfigValue]
    }

    struct PromptEntry: Codable
    {
        let name: String
        let path: String
        let kind: String
    }

    struct PromptListResponse: Codable
    {
        let directory: String
        let entries: [PromptEntry]
    }

    struct PromptPreviewResponse: Codable
    {
        let path: String
        let body: String
        let byte_count: Int
    }

    struct PromptSelectionRequest: Decodable
    {
        let target: String
        let path: String
    }

    struct InjectableRulesResponse: Codable
    {
        let rules: [InjectableRule]
        let updated_at: String
    }

    struct InjectableRule: Codable
    {
        let key: String
        let prompt_path: String
    }

    struct InjectableRuleUpsertRequest: Decodable
    {
        let key: String
        let prompt_path: String
    }

    struct InteractionSummary: Codable
    {
        let id: String
        let occurred_at: String
        let source: String
        let status: String
        let provider: String
        let model: String
        let transcribe_ms: Int
        let refine_ms: Int
        let total_pipeline_ms: Int
        let output_preview: String
        let error_preview: String?
    }

    struct InteractionListResponse: Codable
    {
        let interactions: [InteractionSummary]
    }

    struct InteractionDetailResponse: Codable
    {
        let id: String
        let occurred_at: String
        let source: String
        let status: String
        let provider: String
        let model: String
        let reasoning_effort: String?
        let system_prompt_path: String
        let system_prompt_body: String
        let whisper_output: String
        let final_output: String
        let optional_context: [String: String]
        let edit_summary: String
        let uncertainty_flags: [String]
        let fallback_used: Bool?
        let error_message: String?
        let timings: InteractionTimings
    }

    struct InteractionTimings: Codable
    {
        let transcribe_ms: Int
        let refine_ms: Int
        let insert_ms: Int
        let total_pipeline_ms: Int
    }

    struct ModelsResponse: Codable
    {
        let provider: String
        let models: [String]
        let warning: String?
    }

    struct APIKeyStatusResponse: Codable
    {
        let openai: APIKeyProviderStatus
    }

    struct APIKeyProviderStatus: Codable
    {
        let configured: Bool
    }
}

enum WebConfigFieldMapping
{
    static let cloudModel = "cloud_model"
    static let localModel = "local_model"
    static let audioInput = "audio_input"
    static let useCloud = "use_cloud"
    static let systemPrompt = "system_prompt"
    static let auxiliarySystemPrompt1 = "auxiliary_system_prompt_1"
    static let auxiliarySystemPrompt2 = "auxiliary_system_prompt_2"
    static let interactionsBufferBytes = "interactions_buffer_bytes"

    static let managerNameByField: [String: String] = [
        cloudModel: "Cloud Model",
        localModel: "Local Model",
        audioInput: "Audio Input",
        useCloud: "Use Cloud",
        systemPrompt: "System Prompt",
        auxiliarySystemPrompt1: "Auxiliary Prompt 1",
        auxiliarySystemPrompt2: "Auxiliary Prompt 2",
        interactionsBufferBytes: "Interactions Buffer"
    ]

    static let labelByField: [String: String] = [
        cloudModel: "Cloud model",
        localModel: "Local model",
        audioInput: "Audio input",
        useCloud: "Use cloud provider",
        systemPrompt: "Primary system prompt",
        auxiliarySystemPrompt1: "Auxiliary prompt 1",
        auxiliarySystemPrompt2: "Auxiliary prompt 2",
        interactionsBufferBytes: "Interaction history buffer"
    ]

    static let editableFields: Set<String> = Set(managerNameByField.keys)

    static func managerName(for field: String) -> String?
    {
        managerNameByField[field]
    }
}
