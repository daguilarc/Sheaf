import { BASELINE_VOICE_NAV_SYSTEM_PROMPT } from "./prompts.js";

export function ResolveSystemPrompt(configured: string | undefined): string
{
  const trimmed = configured?.trim();
  if (trimmed !== undefined && trimmed.length > 0)
  {
    return trimmed;
  }

  return BASELINE_VOICE_NAV_SYSTEM_PROMPT;
}

export interface ResolveOpenAiApiKeyInput
{
  secretValue?: string;
  repoConfigValue?: string;
  settingValue?: string;
}

export function ResolveOpenAiApiKey(input: ResolveOpenAiApiKeyInput): string | undefined
{
  const fromSecret = input.secretValue?.trim();
  if (fromSecret !== undefined && fromSecret.length > 0)
  {
    return fromSecret;
  }

  const fromRepo = input.repoConfigValue?.trim();
  if (fromRepo !== undefined && fromRepo.length > 0)
  {
    return fromRepo;
  }

  const fromSetting = input.settingValue?.trim();
  if (fromSetting !== undefined && fromSetting.length > 0)
  {
    return fromSetting;
  }

  return undefined;
}

export const x_missingOpenAiApiKeyMessage =
  "Sheaf realtime: set an OpenAI API key (VS Code Secret Storage, config/api_keys.json, or sheaf.realtime.openAiApiKey setting).";
