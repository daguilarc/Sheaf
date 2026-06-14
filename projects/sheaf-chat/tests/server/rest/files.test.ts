import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { WriteInitialManifest } from "../../../src/storage/index.js";
import {
  CreateWorkspaceChatViaApi,
  RequestJson,
  ResolveOpenAiTestModel,
  type TestServerHandle,
  WithTestServer,
} from "./helpers.js";

function ErrorBody(body: unknown): { code: string; message: string }
{
  assert.ok(body !== null && typeof body === "object");
  const error = (body as { error?: { code?: string; message?: string } }).error;
  assert.ok(error);
  assert.equal(typeof error.code, "string");
  assert.equal(typeof error.message, "string");
  return {
    code: error.code as string,
    message: error.message as string,
  };
}

async function CreateSessionWithDocs(
  handle: TestServerHandle,
  agentManager: import("../../../src/agents/manager.js").AgentManager,
  options?: { manifested?: boolean },
): Promise<{
  repoId: string;
  workspaceId: string;
  chatId: string;
  repoRoot: string;
  workspacePath: string;
}>
{
  const model = ResolveOpenAiTestModel(agentManager);
  const created = await CreateWorkspaceChatViaApi(handle);
  const repoRoot = agentManager.storagePaths.repoRoot;
  const docsDir = path.join(repoRoot, "projects/demo/docs");
  const notesDir = path.join(docsDir, "notes");

  await mkdir(notesDir, { recursive: true });
  await writeFile(path.join(docsDir, "readme.md"), "# Title\n", "utf-8");
  await writeFile(path.join(notesDir, "todo.txt"), "todo", "utf-8");
  await writeFile(path.join(docsDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]), "utf-8");
  await mkdir(path.join(docsDir, "node_modules"), { recursive: true });
  await writeFile(path.join(docsDir, "node_modules/pkg.js"), "hidden", "utf-8");

  if (options?.manifested)
  {
    await WriteInitialManifest(agentManager.storagePaths, {
      repoId: created.repoId,
      workspaceId: created.workspaceId,
      chatId: created.chatId,
      repositoryPath: created.workspacePath,
      workspacePath: created.workspacePath,
      chatName: "Docs chat",
      description: "desc",
      rootDirectory: created.workspacePath,
      model,
      extensionVersion: "0.1.0",
    });
  }

  return { ...created, repoRoot };
}

function ChatFileRoute(
  session: { repoId: string; workspaceId: string; chatId: string },
  endpoint: "file" | "files",
  relativePath?: string,
): string
{
  const route =
    `/api/repositories/${encodeURIComponent(session.repoId)}` +
    `/workspaces/${encodeURIComponent(session.workspaceId)}` +
    `/chats/${encodeURIComponent(session.chatId)}/${endpoint}`;
  return relativePath === undefined
    ? route
    : `${route}?path=${encodeURIComponent(relativePath)}`;
}

test("file browser retrieves markdown and lists directories for provisional sessions", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { baseUrl, agentManager } = handle;
    const session = await CreateSessionWithDocs(handle, agentManager);

    const file = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "docs/readme.md"),
    );
    assert.equal(file.status, 200);

    const fileBody = file.body as {
      file: {
        name: string;
        path: string;
        kind: string;
        supported: boolean;
        contentType: string;
        content: string;
        size: number;
        modifiedAt: string;
      };
    };

    assert.equal(fileBody.file.name, "readme.md");
    assert.equal(fileBody.file.path, "docs/readme.md");
    assert.equal(fileBody.file.kind, "file");
    assert.equal(fileBody.file.supported, true);
    assert.equal(fileBody.file.contentType, "text/markdown");
    assert.equal(fileBody.file.content, "# Title\n");
    assert.equal(fileBody.file.size, 8);
    assert.equal(typeof fileBody.file.modifiedAt, "string");

    const rootListing = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "files"),
    );
    assert.equal(rootListing.status, 200);

    const rootBody = rootListing.body as {
      directory: { name: string; path: string; kind: string };
      entries: Array<{ name: string; path: string; kind: string }>;
    };

    assert.equal(rootBody.directory.path, ".");
    assert.equal(rootBody.directory.kind, "directory");
    assert.ok(rootBody.entries.some((entry) => entry.path === "docs" && entry.kind === "directory"));

    const docsListing = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "files", "docs"),
    );
    assert.equal(docsListing.status, 200);

    const docsBody = docsListing.body as {
      directory: { path: string };
      entries: Array<{
        name: string;
        path: string;
        kind: string;
        supported?: boolean;
        contentType?: string;
      }>;
    };

    assert.equal(docsBody.directory.path, "docs");
    assert.deepEqual(
      docsBody.entries.map((entry) => entry.name),
      ["notes", "image.png", "readme.md"],
    );
    assert.ok(docsBody.entries.find((entry) => entry.name === "readme.md")?.supported);
    assert.equal(
      docsBody.entries.find((entry) => entry.name === "readme.md")?.contentType,
      "text/markdown",
    );
    assert.equal(docsBody.entries.find((entry) => entry.name === "image.png")?.supported, false);
    assert.ok(!docsBody.entries.some((entry) => entry.name === "node_modules"));
  });
});

test("file browser works for manifested sessions", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { baseUrl, agentManager } = handle;
    const session = await CreateSessionWithDocs(handle, agentManager, {
      manifested: true,
    });

    const file = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "docs/readme.md"),
    );
    assert.equal(file.status, 200);
    assert.equal((file.body as { file: { content: string } }).file.content, "# Title\n");
  });
});

test("file browser rejects path escapes and invalid file requests", async () =>
{
  await WithTestServer(async (handle) =>
  {
    const { baseUrl, agentManager } = handle;
    const session = await CreateSessionWithDocs(handle, agentManager);
    const { repoRoot } = session;
    const outsideDir = path.join(repoRoot, "outside");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(path.join(outsideDir, "secret.md"), "secret", "utf-8");
    await symlink(
      path.join(outsideDir, "secret.md"),
      path.join(repoRoot, "projects/demo/docs/escape-link"),
    );

    const missingPath = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "docs/missing.md"),
    );
    assert.equal(missingPath.status, 404);
    assert.equal(ErrorBody(missingPath.body).code, "file_not_found");

    const emptyPath = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file"),
    );
    assert.equal(emptyPath.status, 400);
    assert.equal(ErrorBody(emptyPath.body).code, "invalid_request");

    const parentTraversal = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "../outside/secret.md"),
    );
    assert.equal(parentTraversal.status, 403);
    assert.equal(ErrorBody(parentTraversal.body).code, "path_escape");

    const encodedTraversal = await RequestJson(
      baseUrl,
      "GET",
      `${ChatFileRoute(session, "file")}?path=docs%2F..%2F..%2Foutside%2Fsecret.md`,
    );
    assert.equal(encodedTraversal.status, 403);
    assert.equal(ErrorBody(encodedTraversal.body).code, "path_escape");

    const absolutePath = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", path.join(repoRoot, "outside/secret.md")),
    );
    assert.equal(absolutePath.status, 403);
    assert.equal(ErrorBody(absolutePath.body).code, "path_escape");

    const backslashTraversal = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "docs\\..\\..\\outside\\secret.md"),
    );
    assert.equal(backslashTraversal.status, 403);
    assert.equal(ErrorBody(backslashTraversal.body).code, "path_escape");

    const symlinkEscape = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "docs/escape-link"),
    );
    assert.equal(symlinkEscape.status, 403);
    assert.equal(ErrorBody(symlinkEscape.body).code, "path_escape");

    const directoryAsFile = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "docs"),
    );
    assert.equal(directoryAsFile.status, 400);
    assert.equal(ErrorBody(directoryAsFile.body).code, "not_a_file");

    const rootAsFile = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "."),
    );
    assert.equal(rootAsFile.status, 400);
    assert.equal(ErrorBody(rootAsFile.body).code, "not_a_file");

    const binaryFile = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute(session, "file", "docs/image.png"),
    );
    assert.equal(binaryFile.status, 400);
    assert.equal(ErrorBody(binaryFile.body).code, "unsupported_file");

    const missingSession = await RequestJson(
      baseUrl,
      "GET",
      ChatFileRoute({ ...session, chatId: "doesnotexist12345" }, "file", "docs/readme.md"),
    );
    assert.equal(missingSession.status, 404);
    assert.equal(ErrorBody(missingSession.body).code, "chat_not_found");
  });
});
