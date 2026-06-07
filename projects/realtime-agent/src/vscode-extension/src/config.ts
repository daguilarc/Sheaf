import * as vscode from "vscode";

import {
  ResolveOpenAiApiKey,
  ResolveSystemPrompt,
  x_missingOpenAiApiKeyMessage,
} from "./configCore.js";
import {
  FindSheafRepositoryRootFromWorkspaceFolders,
  LoadOpenAiApiKeyFromRepoConfig,
} from "./repoConfig.js";

export {
  ResolveOpenAiApiKey,
  ResolveSystemPrompt,
  x_missingOpenAiApiKeyMessage,
} from "./configCore.js";
export {
  FindSheafRepositoryRoot,
  FindSheafRepositoryRootFromWorkspaceFolders,
  LoadOpenAiApiKeyFromRepoConfig,
  ResolveExtensionRuntimeLogPath,
} from "./repoConfig.js";

const x_configSection = "sheaf.realtime";
const x_secretKeyOpenAiApiKey = "sheaf.realtime.openAiApiKey";

export type ConfigLookupFailureHandler = (message: string) => void;

let g_onConfigLookupFailure: ConfigLookupFailureHandler | undefined;

export function SetConfigLookupFailureHandler(handler: ConfigLookupFailureHandler | undefined): void
{
  g_onConfigLookupFailure = handler;
}

export async function getOpenAiApiKey(context: vscode.ExtensionContext): Promise<string | undefined>
{
  const secret = await context.secrets.get(x_secretKeyOpenAiApiKey);
  const setting = vscode.workspace.getConfiguration(x_configSection).get<string>("openAiApiKey");

  let repoConfigValue: string | undefined;
  const folders = vscode.workspace.workspaceFolders ?? [];
  const repoRoot = FindSheafRepositoryRootFromWorkspaceFolders(folders);
  if (repoRoot !== undefined)
  {
    const loaded = await LoadOpenAiApiKeyFromRepoConfig(repoRoot);
    if (loaded.error !== undefined)
    {
      g_onConfigLookupFailure?.(loaded.error);
    }
    repoConfigValue = loaded.apiKey;
  }

  return ResolveOpenAiApiKey({
    secretValue: secret ?? undefined,
    repoConfigValue,
    settingValue: setting,
  });
}

export function getModel(): string
{
  const value = vscode.workspace.getConfiguration(x_configSection).get<string>("model");
  return value !== undefined && value.trim().length > 0 ? value.trim() : "gpt-realtime-2";
}

export function getSystemPrompt(): string
{
  const value = vscode.workspace.getConfiguration(x_configSection).get<string>("systemPrompt");
  return ResolveSystemPrompt(value);
}

export function getInputDevice(): string | undefined
{
  const value = vscode.workspace.getConfiguration(x_configSection).get<string>("inputDevice");
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

export function getSafetyIdentifier(): string | undefined
{
  const value = vscode.workspace.getConfiguration(x_configSection).get<string>("safetyIdentifier");
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
