import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_MAX_READ_BYTES,
  LogStreamSession,
  TRUNCATION_ERROR_MESSAGE,
  computeReadBeforeRange,
  computeTailRange,
  readByteRange,
  validateLogFileForReading,
  type ServerMessage,
} from "../src/index.js";

async function withTempLogRoot(
  run: (context: { logRoot: string }) => Promise<void>,
): Promise<void>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-log-stream-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    await run({ logRoot });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("validateLogFileForReading accepts valid files and rejects unsafe paths", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    await writeFile(join(logRoot, "server.log"), "hello");
    await mkdir(join(logRoot, "nested"), { recursive: true });

    const valid = await validateLogFileForReading(logRoot, "server.log");
    assert.equal(valid.ok, true);

    const missing = await validateLogFileForReading(logRoot, "missing.log");
    assert.equal(missing.ok, false);
    if (!missing.ok)
    {
      assert.equal(missing.error, "log file not found");
    }

    const directory = await validateLogFileForReading(logRoot, "nested");
    assert.equal(directory.ok, false);
    if (!directory.ok)
    {
      assert.equal(directory.error, "log path is a directory");
    }

    const absolute = await validateLogFileForReading(logRoot, "/etc/passwd");
    assert.equal(absolute.ok, false);

    const traversal = await validateLogFileForReading(logRoot, "../beta/server.log");
    assert.equal(traversal.ok, false);
  });
});

test("validateLogFileForReading rejects symlink traversal outside log root", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    const outsideDir = join(logRoot, "..", "outside");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.log"), "secret");
    await symlink(join(outsideDir, "secret.log"), join(logRoot, "escape.log"));

    const result = await validateLogFileForReading(logRoot, "escape.log");
    assert.equal(result.ok, false);
  });
});

test("computeTailRange and readByteRange return bounded tail windows", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    const filePath = join(logRoot, "server.log");
    const content = "abcdefghijklmnopqrstuvwxyz";
    await writeFile(filePath, content);

    const tailRange = computeTailRange(content.length, 5);
    assert.deepEqual(tailRange, { start: 21, end: 26 });

    const text = await readByteRange(filePath, tailRange.start, tailRange.end);
    assert.equal(text, "vwxyz");
  });
});

test("computeTailRange handles files smaller than tail_bytes and zero-byte files", () =>
{
  assert.deepEqual(computeTailRange(3, DEFAULT_MAX_READ_BYTES), { start: 0, end: 3 });
  assert.deepEqual(computeTailRange(0, 100), { start: 0, end: 0 });
});

test("computeReadBeforeRange clamps max_bytes and before offset", () =>
{
  assert.deepEqual(
    computeReadBeforeRange(100, DEFAULT_MAX_READ_BYTES * 2, 200),
    { start: 0, end: 100 },
  );
  assert.deepEqual(computeReadBeforeRange(50, 10, 40), { start: 40, end: 40 });
});

test("LogStreamSession open sends only the requested tail chunk", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    const filePath = join(logRoot, "server.log");
    const content = "x".repeat(200);
    await writeFile(filePath, content);

    const messages: ServerMessage[] = [];
    const session = new LogStreamSession({
      logRoot,
      followPollIntervalMs: 20,
      onMessage(message)
      {
        messages.push(message);
      },
    });

    await session.HandleOpen("server.log", 20);

    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.type, "chunk");

    const chunk = messages[0] as Extract<ServerMessage, { type: "chunk" }>;
    assert.equal(chunk.file, "server.log");
    assert.equal(chunk.start, 180);
    assert.equal(chunk.end, 200);
    assert.equal(chunk.text.length, 20);
  });
});

test("LogStreamSession read_before returns earlier chunk without changing follow offset", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    const filePath = join(logRoot, "server.log");
    await writeFile(filePath, "0123456789");

    const messages: ServerMessage[] = [];
    const session = new LogStreamSession({
      logRoot,
      followPollIntervalMs: 20,
      onMessage(message)
      {
        messages.push(message);
      },
    });

    await session.HandleOpen("server.log", 4);
    await session.HandleReadBefore(6, 3);

    assert.equal(messages.length, 2);
    const chunk = messages[1] as Extract<ServerMessage, { type: "chunk" }>;
    assert.equal(chunk.start, 3);
    assert.equal(chunk.end, 6);
    assert.equal(chunk.text, "345");
  });
});

test("LogStreamSession follow delivers appended bytes when enabled", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    const filePath = join(logRoot, "server.log");
    await writeFile(filePath, "start");

    const messages: ServerMessage[] = [];
    const session = new LogStreamSession({
      logRoot,
      followPollIntervalMs: 20,
      onMessage(message)
      {
        messages.push(message);
      },
    });

    await session.HandleOpen("server.log", 10);
    session.HandleFollow(true);
    await writeFile(filePath, "start appended", { flag: "w" });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const appendMessages = messages.filter((message) => message.type === "append");
    assert.ok(appendMessages.length >= 1);
    const append = appendMessages[0] as Extract<ServerMessage, { type: "append" }>;
    assert.equal(append.text, " appended");
    session.Destroy();
  });
});

test("LogStreamSession does not deliver appended bytes while follow is disabled", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    const filePath = join(logRoot, "server.log");
    await writeFile(filePath, "start");

    const messages: ServerMessage[] = [];
    const session = new LogStreamSession({
      logRoot,
      followPollIntervalMs: 20,
      onMessage(message)
      {
        messages.push(message);
      },
    });

    await session.HandleOpen("server.log", 10);
    await writeFile(filePath, "start appended", { flag: "w" });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const appendMessages = messages.filter((message) => message.type === "append");
    assert.equal(appendMessages.length, 0);
    session.Destroy();
  });
});

test("LogStreamSession reports truncation and allows reopen", async () =>
{
  await withTempLogRoot(async ({ logRoot }) =>
  {
    const filePath = join(logRoot, "server.log");
    await writeFile(filePath, "0123456789");

    const messages: ServerMessage[] = [];
    const session = new LogStreamSession({
      logRoot,
      followPollIntervalMs: 20,
      onMessage(message)
      {
        messages.push(message);
      },
    });

    await session.HandleOpen("server.log", 4);
    session.HandleFollow(true);
    await writeFile(filePath, "short", { flag: "w" });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const errorMessages = messages.filter((message) => message.type === "error");
    assert.ok(errorMessages.some((message) => message.message === TRUNCATION_ERROR_MESSAGE));
    assert.equal(session.HasOpenFile(), false);

    await session.HandleOpen("server.log", 10);
    const chunkMessages = messages.filter((message) => message.type === "chunk");
    assert.equal(chunkMessages.length, 2);
    session.Destroy();
  });
});
