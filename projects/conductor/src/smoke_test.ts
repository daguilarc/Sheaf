import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";

export const SMOKE_TEST_MODE_ENV_VAR = "SHEAF_SMOKE_TEST_MODE";
export const SMOKE_ASSET_ROOT_ENV_VAR = "SHEAF_SMOKE_ASSET_ROOT";

export function isSmokeTestModeActive(value: string | undefined): boolean
{
  if (value === undefined)
  {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0 || normalized === "0" || normalized === "false")
  {
    return false;
  }

  return true;
}

export type GitCommonDirReader = (repoRoot: string) => string | undefined;

function readGitCommonDir(repoRoot: string): string | undefined
{
  try
  {
    const output = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  catch
  {
    return undefined;
  }
}

export type DiscoverSmokeAssetRootOptions =
{
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
  readGitCommonDir?: GitCommonDirReader;
};

// Resolves the repository whose git-ignored assets a smoke-test launch should
// use. Order: explicit SHEAF_SMOKE_ASSET_ROOT override, else the main working
// tree discovered from git (the parent of the shared .git directory), else the
// caller's own repo root when it is itself the main checkout.
export function discoverSmokeAssetRoot(options: DiscoverSmokeAssetRootOptions): string
{
  const env = options.env ?? process.env;
  const override = env[SMOKE_ASSET_ROOT_ENV_VAR];

  if (override !== undefined && override.trim().length > 0)
  {
    return override.trim();
  }

  const reader = options.readGitCommonDir ?? readGitCommonDir;
  const commonDir = reader(options.repoRoot);

  if (commonDir !== undefined)
  {
    const absoluteCommonDir = isAbsolute(commonDir)
      ? commonDir
      : resolve(options.repoRoot, commonDir);
    // The parent of the shared `.git` directory is the main working tree. The
    // asset root need not exist here; the service warns and falls back when
    // SHEAF_SMOKE_ASSET_ROOT does not resolve to a real directory.
    return dirname(absoluteCommonDir);
  }

  return options.repoRoot;
}

export type SmokeTestEnv = Record<string, string>;

// Builds the environment overrides Conductor injects into a service spawned in
// smoke-test mode.
export function buildSmokeTestEnv(assetRoot: string): SmokeTestEnv
{
  return {
    [SMOKE_TEST_MODE_ENV_VAR]: "1",
    [SMOKE_ASSET_ROOT_ENV_VAR]: assetRoot,
  };
}
