import type {
  ModelRegistry,
  ProviderConfig,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

import type { SheafChatConfig } from "../server/config.js";

export const x_localProviderName = "local";
export const x_localDefaultModelId = "local-default";

export const x_localMissingUrlReason = "local_inference_url_missing";
export const x_localMissingKeyReason = "local_inference_api_key_missing";
export const x_localFetchFailedReason = "local_models_fetch_failed";

export interface LocalModelDescriptor
{
  id: string;
  displayName: string;
  contextTokens?: number;
}

export interface LocalProviderState
{
  models: LocalModelDescriptor[];
  fetchError: string | null;
  unavailableReason: string | null;
}

export interface FetchLocalModelsOptions
{
  fetchImpl?: typeof fetch;
}

export function NormalizeInferenceBaseUrl(url: string): string
{
  return url.replace(/\/+$/, "");
}

export function BuildModelsEndpointUrl(baseUrl: string): string
{
  const normalized = NormalizeInferenceBaseUrl(baseUrl);
  return normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`;
}

export function CreateUnavailableLocalProviderState(reason: string): LocalProviderState
{
  return {
    models: [
      {
        id: x_localDefaultModelId,
        displayName: x_localDefaultModelId,
      },
    ],
    fetchError: reason,
    unavailableReason: reason,
  };
}

export function ResolveLocalProviderState(config: SheafChatConfig): LocalProviderState
{
  if (config.localInferenceUrl === null)
  {
    return CreateUnavailableLocalProviderState(x_localMissingUrlReason);
  }

  if (config.localInferenceApiKey === null)
  {
    return CreateUnavailableLocalProviderState(x_localMissingKeyReason);
  }

  return {
    models: [],
    fetchError: null,
    unavailableReason: null,
  };
}

export async function FetchLocalModels(
  config: SheafChatConfig,
  options: FetchLocalModelsOptions = {},
): Promise<LocalProviderState>
{
  const baseState = ResolveLocalProviderState(config);

  if (baseState.unavailableReason !== null)
  {
    return baseState;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const modelsUrl = BuildModelsEndpointUrl(config.localInferenceUrl!);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.localInferenceApiKey}`,
  };

  try
  {
    const response = await fetchImpl(modelsUrl, { headers });

    if (!response.ok)
    {
      return {
        models: [
          {
            id: x_localDefaultModelId,
            displayName: x_localDefaultModelId,
          },
        ],
        fetchError: `${x_localFetchFailedReason}:${response.status}`,
        unavailableReason: x_localFetchFailedReason,
      };
    }

    const payload = (await response.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        context_window?: number;
        max_tokens?: number;
      }>;
    };

    const models = (payload.data ?? [])
      .filter((entry): entry is { id: string; name?: string; context_window?: number } =>
        typeof entry.id === "string" && entry.id.length > 0)
      .map((entry) => ({
        id: entry.id,
        displayName: entry.name ?? entry.id,
        contextTokens:
          typeof entry.context_window === "number" && Number.isFinite(entry.context_window)
            ? Math.floor(entry.context_window)
            : undefined,
      }));

    if (models.length === 0)
    {
      return {
        models: [
          {
            id: x_localDefaultModelId,
            displayName: x_localDefaultModelId,
          },
        ],
        fetchError: x_localFetchFailedReason,
        unavailableReason: x_localFetchFailedReason,
      };
    }

    return {
      models,
      fetchError: null,
      unavailableReason: null,
    };
  }
  catch
  {
    return {
      models: [
        {
          id: x_localDefaultModelId,
          displayName: x_localDefaultModelId,
        },
      ],
      fetchError: x_localFetchFailedReason,
      unavailableReason: x_localFetchFailedReason,
    };
  }
}

export function BuildLocalProviderModelConfigs(
  localState: LocalProviderState,
): ProviderModelConfig[]
{
  return localState.models.map((model) => ({
    id: model.id,
    name: model.displayName,
    reasoning: false,
    input: ["text"] as const,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: model.contextTokens ?? 128000,
    maxTokens: 16384,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  }));
}

export function BuildLocalProviderRegistration(
  config: SheafChatConfig,
  localState: LocalProviderState,
): ProviderConfig
{
  const baseUrl = config.localInferenceUrl ?? "http://127.0.0.1/v1";

  return {
    name: "Local Inference",
    baseUrl: NormalizeInferenceBaseUrl(baseUrl),
    apiKey: x_localProviderName,
    api: "openai-completions",
    authHeader: true,
    models: BuildLocalProviderModelConfigs(localState),
  };
}

export function IsLocalModelAvailable(
  config: SheafChatConfig,
  localState: LocalProviderState,
): boolean
{
  return config.localInferenceAvailable && localState.unavailableReason === null;
}

export function RegisterLocalProviderOnRegistry(
  modelRegistry: ModelRegistry,
  config: SheafChatConfig,
  localState: LocalProviderState,
): void
{
  modelRegistry.registerProvider(
    x_localProviderName,
    BuildLocalProviderRegistration(config, localState),
  );
}
