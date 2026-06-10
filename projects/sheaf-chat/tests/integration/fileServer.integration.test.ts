import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { RequestJson } from "../server/rest/helpers.js";
import {
  AssertFileChangedPayload,
  BuildWsUrl,
  ConnectWebSocket,
  CreateSessionWithRoot,
  RunSessionEdit,
  WaitForEnvelope,
  WithWebSocketTestServer,
  WriteSessionFile,
} from "../server/websocket/helpers.js";

function ExtractFileContent(body: unknown): string
{
  assert.ok(body !== null && typeof body === "object");
  const file = (body as { file?: { content?: unknown } }).file;
  assert.ok(file);
  assert.equal(typeof file.content, "string");
  return file.content as string;
}

test("file server integrates REST browsing, controlled edits, websocket broadcasts, and refetch", async () =>
{
  await WithWebSocketTestServer(async (handle) =>
  {
    const parentRoot = path.join(handle.config.repoRoot, "projects");
    const childRoot = path.join(parentRoot, "demo");
    await WriteSessionFile(childRoot, "docs/readme.md", "# Initial\n\n[Other](other.md)\n");
    await WriteSessionFile(childRoot, "docs/other.md", "# Other\n");

    const parentSession = await CreateSessionWithRoot(handle, parentRoot);
    const childSession = await CreateSessionWithRoot(handle, childRoot);
    const parentConnection = await ConnectWebSocket(
      BuildWsUrl(handle, parentSession.pile, parentSession.sessionId, { clientId: "parent" }),
    );
    const childConnection = await ConnectWebSocket(
      BuildWsUrl(handle, childSession.pile, childSession.sessionId, { clientId: "child" }),
    );

    try
    {
      const childList = await RequestJson(
        handle.baseUrl,
        "GET",
        `/api/piles/${childSession.pile}/sessions/${childSession.sessionId}/files?path=${encodeURIComponent("docs")}`,
      );
      assert.equal(childList.status, 200);
      const childEntries = (childList.body as {
        entries: Array<{ path: string; kind: string; supported?: boolean }>;
      }).entries;
      assert.ok(
        childEntries.some((entry) =>
          entry.path === "docs/readme.md" &&
          entry.kind === "file" &&
          entry.supported === true,
        ),
      );

      const childBefore = await RequestJson(
        handle.baseUrl,
        "GET",
        `/api/piles/${childSession.pile}/sessions/${childSession.sessionId}/file?path=${encodeURIComponent("docs/readme.md")}`,
      );
      assert.equal(childBefore.status, 200);
      assert.equal(ExtractFileContent(childBefore.body), "# Initial\n\n[Other](other.md)\n");

      const parentBefore = await RequestJson(
        handle.baseUrl,
        "GET",
        `/api/piles/${parentSession.pile}/sessions/${parentSession.sessionId}/file?path=${encodeURIComponent("demo/docs/readme.md")}`,
      );
      assert.equal(parentBefore.status, 200);
      assert.equal(ExtractFileContent(parentBefore.body), "# Initial\n\n[Other](other.md)\n");

      const childChanged = WaitForEnvelope(
        childConnection.socket,
        (envelope) =>
          envelope.kind === "file.changed" &&
          (envelope.payload as { path?: string }).path === "docs/readme.md",
      );
      const parentChanged = WaitForEnvelope(
        parentConnection.socket,
        (envelope) =>
          envelope.kind === "file.changed" &&
          (envelope.payload as { path?: string }).path === "demo/docs/readme.md",
      );

      await RunSessionEdit(handle, childSession, {
        path: "docs/readme.md",
        edits: [{ oldText: "# Initial", newText: "# Updated" }],
      });

      const [childEnvelope, parentEnvelope] = await Promise.all([childChanged, parentChanged]);
      AssertFileChangedPayload(childEnvelope, "docs/readme.md", handle.config.repoRoot);
      AssertFileChangedPayload(parentEnvelope, "demo/docs/readme.md", handle.config.repoRoot);

      const childAfter = await RequestJson(
        handle.baseUrl,
        "GET",
        `/api/piles/${childSession.pile}/sessions/${childSession.sessionId}/file?path=${encodeURIComponent("docs/readme.md")}`,
      );
      assert.equal(childAfter.status, 200);
      assert.equal(ExtractFileContent(childAfter.body), "# Updated\n\n[Other](other.md)\n");

      const parentAfter = await RequestJson(
        handle.baseUrl,
        "GET",
        `/api/piles/${parentSession.pile}/sessions/${parentSession.sessionId}/file?path=${encodeURIComponent("demo/docs/readme.md")}`,
      );
      assert.equal(parentAfter.status, 200);
      assert.equal(ExtractFileContent(parentAfter.body), "# Updated\n\n[Other](other.md)\n");
    }
    finally
    {
      parentConnection.socket.close();
      childConnection.socket.close();
    }
  });
});
