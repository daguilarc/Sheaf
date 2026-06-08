import path from "node:path";

import { AuthStorage } from "@earendil-works/pi-coding-agent";

import type { SheafChatConfig } from "../server/config.js";

export const x_piAgentDirName = "pi-agent";
export const x_openaiAuthSubdir = "openai";

export function ResolveSheafAgentDir(config: SheafChatConfig): string
{
  return path.join(config.paths.dataDir, x_piAgentDirName);
}

export function ResolveSheafAuthJsonPath(config: SheafChatConfig): string
{
  return path.join(ResolveSheafAgentDir(config), "auth.json");
}

export function ResolveSheafModelsJsonPath(config: SheafChatConfig): string
{
  return path.join(ResolveSheafAgentDir(config), "models.json");
}

export function ResolveOpenAiAuthDir(config: SheafChatConfig): string
{
  return path.join(config.paths.authDir, x_openaiAuthSubdir);
}

export function IsGlobalPiPath(filePath: string): boolean
{
  const normalized = path.normalize(filePath);
  const piSegment = `${path.sep}.pi${path.sep}`;
  return normalized.includes(piSegment) || normalized.endsWith(`${path.sep}.pi`);
}

export function AssertNotGlobalPiPath(filePath: string): void
{
  if (IsGlobalPiPath(filePath))
  {
    throw new Error(`refusing to use global Pi path: ${filePath}`);
  }
}

export function CreateSheafAuthStorage(config: SheafChatConfig): AuthStorage
{
  const authPath = ResolveSheafAuthJsonPath(config);
  AssertNotGlobalPiPath(authPath);
  return AuthStorage.create(authPath);
}
