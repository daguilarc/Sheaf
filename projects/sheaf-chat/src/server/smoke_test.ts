import { existsSync, statSync } from "node:fs";

export const x_smokeTestModeEnvVar = "SHEAF_SMOKE_TEST_MODE";
export const x_smokeAssetRootEnvVar = "SHEAF_SMOKE_ASSET_ROOT";

// Smoke-test mode is active when the variable is set to any non-empty value
// other than `0` or `false` (case-insensitive).
export function IsSmokeTestModeActive(value: string | undefined): boolean
{
  if (value === undefined)
  {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return !(normalized.length === 0 || normalized === "0" || normalized === "false");
}

export interface ResolvedSmokeAssetRoot
{
  assetRoot: string;
  usedSmokeAssetRoot: boolean;
  warning: string | null;
}

export interface ResolveSmokeAssetRootOptions
{
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  directoryExists?: (candidate: string) => boolean;
}

function defaultDirectoryExists(candidate: string): boolean
{
  return existsSync(candidate) && statSync(candidate).isDirectory();
}

// Resolves the directory git-ignored assets (e.g. config/api_keys.json) should
// be loaded from. When smoke mode is inactive, returns repoRoot. When active
// and SHEAF_SMOKE_ASSET_ROOT names an existing directory, returns that. When
// active but the asset root is unset/empty/missing, returns repoRoot with a
// warning describing the fallback.
export function ResolveSmokeAssetRoot(
  options: ResolveSmokeAssetRootOptions,
): ResolvedSmokeAssetRoot
{
  const env = options.env ?? process.env;
  const directoryExists = options.directoryExists ?? defaultDirectoryExists;

  if (!IsSmokeTestModeActive(env[x_smokeTestModeEnvVar]))
  {
    return { assetRoot: options.repoRoot, usedSmokeAssetRoot: false, warning: null };
  }

  const rawAssetRoot = (env[x_smokeAssetRootEnvVar] ?? "").trim();

  if (rawAssetRoot.length === 0)
  {
    return {
      assetRoot: options.repoRoot,
      usedSmokeAssetRoot: false,
      warning: `smoke-test mode active but ${x_smokeAssetRootEnvVar} is unset or empty; using repo root for assets`,
    };
  }

  if (!directoryExists(rawAssetRoot))
  {
    return {
      assetRoot: options.repoRoot,
      usedSmokeAssetRoot: false,
      warning: `smoke-test mode active but ${x_smokeAssetRootEnvVar} (${rawAssetRoot}) is not an existing directory; using repo root for assets`,
    };
  }

  return { assetRoot: rawAssetRoot, usedSmokeAssetRoot: true, warning: null };
}
