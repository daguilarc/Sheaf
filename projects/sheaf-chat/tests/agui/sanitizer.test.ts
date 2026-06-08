import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RedactSecrets,
  RelativizeAbsolutePath,
  SanitizeString,
  SanitizeValue,
  x_outsideRootPath,
  x_redactedSecret,
} from "../../src/agui/sanitizer.js";

test("RedactSecrets masks bearer tokens and api keys", () =>
{
  const input = "Authorization: Bearer abc.def-ghi and api_key=supersecretvalue";
  const output = RedactSecrets(input);

  assert.match(output, new RegExp(x_redactedSecret));
  assert.doesNotMatch(output, /supersecretvalue/);
  assert.doesNotMatch(output, /abc\.def-ghi/);
});

test("RelativizeAbsolutePath keeps in-root paths relative and masks outside-root paths", async () =>
{
  const parent = await mkdtemp(path.join(tmpdir(), "sheaf-chat-sanitize-"));
  const rootDirectory = path.join(parent, "root");
  const insideFile = path.join(rootDirectory, "src", "app.ts");
  const outsideFile = path.join(parent, "outside", "secret.txt");
  await mkdir(path.dirname(insideFile), { recursive: true });
  await mkdir(path.dirname(outsideFile), { recursive: true });
  await writeFile(insideFile, "x", "utf8");
  await writeFile(outsideFile, "y", "utf8");

  try
  {
    assert.equal(RelativizeAbsolutePath(insideFile, rootDirectory), "src/app.ts");
    assert.equal(RelativizeAbsolutePath(outsideFile, rootDirectory), x_outsideRootPath);
  }
  finally
  {
    await import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true }));
  }
});

test("SanitizeString redacts secrets and relativizes absolute in-root paths", async () =>
{
  const parent = await mkdtemp(path.join(tmpdir(), "sheaf-chat-sanitize-"));
  const rootDirectory = path.join(parent, "root");
  const insideFile = path.join(rootDirectory, "src", "main.ts");
  await mkdir(path.dirname(insideFile), { recursive: true });
  await writeFile(insideFile, "main", "utf8");

  try
  {
    const output = SanitizeString(
      `token=abcdef123456 path=${insideFile}`,
      { canonicalRoot: rootDirectory },
    );

    assert.match(output, /\[REDACTED\]/);
    assert.match(output, /src\/main\.ts/);
    assert.doesNotMatch(output, new RegExp(insideFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  finally
  {
    await import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true }));
  }
});

test("SanitizeValue walks nested objects", () =>
{
  const output = SanitizeValue({
    nested: {
      token: "api_key=abcdefghijklmnop",
      note: "plain",
    },
  });

  assert.deepEqual(output, {
    nested: {
      token: x_redactedSecret,
      note: "plain",
    },
  });
});
