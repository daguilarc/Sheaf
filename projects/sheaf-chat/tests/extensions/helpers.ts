import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CreateAuditLogger } from "../../src/extensions/sheaf-chat/audit.js";
import { BuildScopedTools } from "../../src/extensions/sheaf-chat/tools/createScopedTools.js";
import type { ScopedActivityEvent } from "../../src/extensions/sheaf-chat/audit.js";
import type {
  FileChangedNotification,
  ScopedToolContext,
  ScopedToolDefinition,
} from "../../src/extensions/sheaf-chat/types.js";

export interface ScopedTestFixture
{
  rootDirectory: string;
  outsideDirectory: string;
  context: ScopedToolContext;
  tools: Map<string, ScopedToolDefinition>;
  activityEvents: ScopedActivityEvent[];
  cleanup(): Promise<void>;
}

export interface CreateScopedTestFixtureOptions
{
  notifyFileChanged?: (event: FileChangedNotification) => void | Promise<void>;
}

export async function CreateScopedTestFixture(
  layout?: (rootDirectory: string, outsideDirectory: string) => Promise<void>,
  options: CreateScopedTestFixtureOptions = {},
): Promise<ScopedTestFixture>
{
  const parent = await mkdtemp(path.join(tmpdir(), "sheaf-chat-tools-"));
  const rootDirectory = path.join(parent, "root");
  const outsideDirectory = path.join(parent, "outside");
  await mkdir(rootDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });

  if (layout)
  {
    await layout(rootDirectory, outsideDirectory);
  }

  const activityEvents: ScopedActivityEvent[] = [];
  const emitActivity = (event: ScopedActivityEvent): void =>
  {
    activityEvents.push(event);
  };
  const audit = CreateAuditLogger({ emitActivity });
  const built = await BuildScopedTools({
    rootDirectory,
    audit,
    emitActivity,
    notifyFileChanged: options.notifyFileChanged,
  });
  const tools = new Map(built.tools.map((tool) => [tool.name, tool]));

  return {
    rootDirectory,
    outsideDirectory,
    context: built.context,
    tools,
    activityEvents,
    async cleanup(): Promise<void>
    {
      await rm(parent, { recursive: true, force: true });
    },
  };
}

export async function RunTool(
  fixture: ScopedTestFixture,
  toolName: string,
  params: Record<string, unknown>,
)
{
  const tool = fixture.tools.get(toolName);

  if (!tool)
  {
    throw new Error(`Missing tool: ${toolName}`);
  }

  return tool.execute("test-call", params, undefined);
}

export async function WriteRootFile(
  rootDirectory: string,
  relativePath: string,
  content: string,
): Promise<string>
{
  const absolutePath = path.join(rootDirectory, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
  return absolutePath;
}

export async function CreateOutsideSymlink(
  rootDirectory: string,
  outsideDirectory: string,
  linkRelativePath: string,
  targetRelativeToOutside: string,
): Promise<void>
{
  const linkPath = path.join(rootDirectory, linkRelativePath);
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(path.join(outsideDirectory, targetRelativeToOutside), linkPath);
}
