import * as vscode from "vscode";

import { ResolveOpenAiApiKey, ResolveSystemPrompt } from "./configCore.js";

export { ResolveOpenAiApiKey, ResolveSystemPrompt } from "./configCore.js";

const x_configSection = "sheaf.realtime";
const x_secretKeyOpenAiApiKey = "sheaf.realtime.openAiApiKey";

export async function getOpenAiApiKey(context: vscode.ExtensionContext): Promise<string | undefined>
{
  const secret = await context.secrets.get(x_secretKeyOpenAiApiKey);
  const setting = vscode.workspace.getConfiguration(x_configSection).get<string>("openAiApiKey");
  return ResolveOpenAiApiKey(secret ?? undefined, setting, process.env.OPENAI_API_KEY);
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
