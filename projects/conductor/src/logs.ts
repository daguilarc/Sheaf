import { readdir, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export type LogFileEntry =
{
  path: string;
  size: number;
  modified_at: string;
};

export type LogListResult =
{
  name: string;
  log_root: string;
  files: LogFileEntry[];
};

export function normalizeRelativeLogPath(relativePath: string): string | null
{
  if (relativePath.length === 0)
  {
    return null;
  }

  if (relativePath.startsWith("/") || relativePath.startsWith("\\"))
  {
    return null;
  }

  const segments = relativePath.split(/[\\/]+/);

  for (const segment of segments)
  {
    if (segment === "..")
    {
      return null;
    }
  }

  return segments.filter((segment) => segment.length > 0).join("/");
}

export function isPathInsideRoot(resolvedPath: string, resolvedRoot: string): boolean
{
  const normalizedPath = resolvedPath.endsWith(sep) ? resolvedPath : `${resolvedPath}${sep}`;
  const normalizedRoot = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot);
}

export function resolveLogFilePath(logRoot: string, relativePath: string): string | null
{
  const normalizedRelativePath = normalizeRelativeLogPath(relativePath);

  if (normalizedRelativePath === null)
  {
    return null;
  }

  const resolvedRoot = resolve(logRoot);
  const resolvedPath = resolve(resolvedRoot, normalizedRelativePath);

  if (!isPathInsideRoot(resolvedPath, resolvedRoot))
  {
    return null;
  }

  return resolvedPath;
}

async function collectLogFiles(
  directoryPath: string,
  logRoot: string,
  files: LogFileEntry[],
): Promise<void>
{
  let entries;

  try
  {
    entries = await readdir(directoryPath, { withFileTypes: true });
  }
  catch (error: unknown)
  {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
    {
      return;
    }

    throw error;
  }

  for (const entry of entries)
  {
    const absolutePath = join(directoryPath, entry.name);

    if (entry.isDirectory())
    {
      await collectLogFiles(absolutePath, logRoot, files);
      continue;
    }

    if (!entry.isFile())
    {
      continue;
    }

    const resolvedRoot = resolve(logRoot);
    const resolvedPath = resolve(absolutePath);

    if (!isPathInsideRoot(resolvedPath, resolvedRoot))
    {
      continue;
    }

    const relativePath = resolvedPath.slice(resolvedRoot.length + 1).split(sep).join("/");
    const fileStat = await stat(resolvedPath);

    files.push({
      path: relativePath,
      size: fileStat.size,
      modified_at: fileStat.mtime.toISOString(),
    });
  }
}

export type LogFileValidationResult =
  | { ok: true; absolutePath: string }
  | { ok: false; error: string };

export async function validateLogFileForReading(
  logRoot: string,
  relativePath: string,
): Promise<LogFileValidationResult>
{
  const resolvedPath = resolveLogFilePath(logRoot, relativePath);

  if (resolvedPath === null)
  {
    return { ok: false, error: "invalid log file path" };
  }

  let fileStat;

  try
  {
    fileStat = await stat(resolvedPath);
  }
  catch (error: unknown)
  {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
    {
      return { ok: false, error: "log file not found" };
    }

    throw error;
  }

  if (fileStat.isDirectory())
  {
    return { ok: false, error: "log path is a directory" };
  }

  if (!fileStat.isFile())
  {
    return { ok: false, error: "log path is not a file" };
  }

  const resolvedRoot = resolve(logRoot);
  const canonicalRoot = await realpath(resolvedRoot);
  const canonicalPath = await realpath(resolvedPath);

  if (!isPathInsideRoot(canonicalPath, canonicalRoot))
  {
    return { ok: false, error: "invalid log file path" };
  }

  return { ok: true, absolutePath: resolvedPath };
}

export async function listServiceLogs(
  serviceName: string,
  logRoot: string,
): Promise<LogListResult>
{
  const resolvedRoot = resolve(logRoot);
  const files: LogFileEntry[] = [];

  await collectLogFiles(resolvedRoot, resolvedRoot, files);

  files.sort((left, right) => left.path.localeCompare(right.path));

  return {
    name: serviceName,
    log_root: `logs/${serviceName}/`,
    files,
  };
}
