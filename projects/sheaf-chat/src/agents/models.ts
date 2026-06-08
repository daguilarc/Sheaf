import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";

import type { SheafChatConfig } from "../server/config.js";
import type { ModelMetadata, ModelReference } from "../shared/types.js";
import { ResolveSheafModelsJsonPath } from "./auth.js";
import {
  FetchLocalModels,
  type FetchLocalModelsOptions,
  IsLocalModelAvailable,
  type LocalProviderState,
  RegisterLocalProviderOnRegistry,
  x_localFetchFailedReason,
  x_localProviderName,
} from "./localProvider.js";

export { CreateSheafProviderExtension } from "./providerExtension.js";
export {
  CreateSheafAuthStorage,
  IsGlobalPiPath,
  ResolveOpenAiAuthDir,
  ResolveSheafAgentDir,
  ResolveSheafAuthJsonPath,
  ResolveSheafModelsJsonPath,
} from "./auth.js";
export {
  BuildLocalProviderRegistration,
  FetchLocalModels,
  type LocalModelDescriptor,
  type LocalProviderState,
  x_localDefaultModelId,
  x_localFetchFailedReason,
  x_localMissingKeyReason,
  x_localMissingUrlReason,
  x_localProviderName,
} from "./localProvider.js";

type PiRegistryModel = ReturnType<ModelRegistry["getAll"]>[number];

export interface SheafModelRegistryBundle
{
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  localProviderState: LocalProviderState;
}

export interface CreateSheafModelRegistryOptions extends FetchLocalModelsOptions
{
  localProviderState?: LocalProviderState;
}

export class ModelValidationError extends Error
{
  readonly code: string;

  constructor(code: string, message: string)
  {
    super(message);
    this.name = "ModelValidationError";
    this.code = code;
  }
}

export async function CreateSheafModelRegistry(
  config: SheafChatConfig,
  authStorage: AuthStorage,
  options: CreateSheafModelRegistryOptions = {},
): Promise<SheafModelRegistryBundle>
{
  const modelsJsonPath = ResolveSheafModelsJsonPath(config);
  const modelRegistry = ModelRegistry.create(authStorage, modelsJsonPath);
  const localProviderState =
    options.localProviderState ?? await FetchLocalModels(config, options);

  if (config.openAiApiKey !== null)
  {
    authStorage.setRuntimeApiKey("openai", config.openAiApiKey);
  }

  if (config.localInferenceApiKey !== null)
  {
    authStorage.setRuntimeApiKey(x_localProviderName, config.localInferenceApiKey);
  }

  RegisterLocalProviderOnRegistry(modelRegistry, config, localProviderState);

  return {
    authStorage,
    modelRegistry,
    localProviderState,
  };
}

export function MapPiModelToMetadata(
  model: PiRegistryModel,
  config: SheafChatConfig,
  modelRegistry: ModelRegistry,
  localProviderState: LocalProviderState,
): ModelMetadata
{
  const available =
    model.provider === x_localProviderName
      ? IsLocalModelAvailable(config, localProviderState) &&
        localProviderState.models.some((entry) => entry.id === model.id)
      : modelRegistry.hasConfiguredAuth(model);

  const metadata: ModelMetadata = {
    provider: model.provider,
    id: model.id,
    displayName: model.name ?? model.id,
    contextTokens:
      typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
        ? model.contextWindow
        : undefined,
    available,
  };

  if (!available && model.provider === x_localProviderName)
  {
    metadata.unavailableReason =
      localProviderState.unavailableReason ?? x_localFetchFailedReason;
  }

  return metadata;
}

export function ListModels(
  config: SheafChatConfig,
  modelRegistry: ModelRegistry,
  localProviderState: LocalProviderState,
): ModelMetadata[]
{
  const models = modelRegistry.getAll();
  const metadata = models.map((model) =>
    MapPiModelToMetadata(model, config, modelRegistry, localProviderState));

  const seen = new Set<string>();
  const merged: ModelMetadata[] = [];

  for (const entry of metadata)
  {
    const key = `${entry.provider}:${entry.id}`;
    if (seen.has(key))
    {
      continue;
    }

    seen.add(key);
    merged.push(entry);
  }

  merged.sort((left, right) =>
  {
    const providerCompare = left.provider.localeCompare(right.provider);
    if (providerCompare !== 0)
    {
      return providerCompare;
    }

    return left.id.localeCompare(right.id);
  });

  return merged;
}

export function ValidateModelSelection(
  config: SheafChatConfig,
  modelRegistry: ModelRegistry,
  localProviderState: LocalProviderState,
  selection: ModelReference,
): ModelMetadata
{
  const model = modelRegistry.find(selection.provider, selection.id);

  if (model === undefined)
  {
    throw new ModelValidationError(
      "model_not_found",
      `model not found: ${selection.provider}/${selection.id}`,
    );
  }

  const metadata = MapPiModelToMetadata(
    model,
    config,
    modelRegistry,
    localProviderState,
  );

  if (!metadata.available)
  {
    throw new ModelValidationError(
      "model_unavailable",
      metadata.unavailableReason
        ? `model unavailable: ${metadata.unavailableReason}`
        : `model unavailable: ${selection.provider}/${selection.id}`,
    );
  }

  return metadata;
}
