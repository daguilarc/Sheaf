import path from "node:path";

export function IsBinaryBuffer(buffer: Buffer): boolean
{
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));

  for (const byte of sample)
  {
    if (byte === 0)
    {
      return true;
    }
  }

  return false;
}

export interface FileSupportInfo
{
  supported: boolean;
  contentType?: string;
}

const x_markdownExtensions = new Set([".md", ".markdown"]);

const x_binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".mp3",
  ".mp4",
  ".woff",
  ".woff2",
]);

export function ClassifyFileByName(fileName: string): FileSupportInfo
{
  const extension = path.extname(fileName).toLowerCase();

  if (x_markdownExtensions.has(extension))
  {
    return {
      supported: true,
      contentType: "text/markdown",
    };
  }

  if (x_binaryExtensions.has(extension))
  {
    return { supported: false };
  }

  return { supported: false };
}

export function ClassifyFile(fileName: string, buffer: Buffer): FileSupportInfo
{
  const byName = ClassifyFileByName(fileName);

  if (byName.supported)
  {
    return byName;
  }

  if (IsBinaryBuffer(buffer))
  {
    return { supported: false };
  }

  return {
    supported: true,
    contentType: "text/plain",
  };
}

export function ClassifyDirectoryEntry(fileName: string): FileSupportInfo
{
  const byName = ClassifyFileByName(fileName);

  if (byName.supported)
  {
    return byName;
  }

  if (x_binaryExtensions.has(path.extname(fileName).toLowerCase()))
  {
    return { supported: false };
  }

  return {
    supported: true,
    contentType: "text/plain",
  };
}
