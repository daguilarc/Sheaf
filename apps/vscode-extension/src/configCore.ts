export function ResolveOpenAiApiKey(
  secretValue: string | undefined,
  settingValue: string | undefined,
  envValue: string | undefined,
): string | undefined
{
  const fromSecret = secretValue?.trim();
  if (fromSecret !== undefined && fromSecret.length > 0)
  {
    return fromSecret;
  }

  const fromSetting = settingValue?.trim();
  if (fromSetting !== undefined && fromSetting.length > 0)
  {
    return fromSetting;
  }

  const fromEnv = envValue?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0)
  {
    return fromEnv;
  }

  return undefined;
}
