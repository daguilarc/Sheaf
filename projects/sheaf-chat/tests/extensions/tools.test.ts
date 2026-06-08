import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { MatchesGlob } from "../../src/extensions/sheaf-chat/glob.js";
import { AssertNoParentLeak } from "../../src/extensions/sheaf-chat/results.js";
import { x_scopedToolNames } from "../../src/extensions/sheaf-chat/tools/createScopedTools.js";
import {
  CreateOutsideSymlink,
  CreateScopedTestFixture,
  RunTool,
  WriteRootFile,
} from "./helpers.js";

function AssertNoAbsoluteLeak(fixture: Awaited<ReturnType<typeof CreateScopedTestFixture>>, text: string): void
{
  assert.doesNotThrow(() => AssertNoParentLeak(text, fixture.context.policy));
  assert.equal(text.includes(fixture.context.policy.canonicalRoot), false);
  assert.equal(text.includes(fixture.outsideDirectory), false);
}

test("CreateScopedTools registers only the scoped tool set", async () =>
{
  const fixture = await CreateScopedTestFixture();
  try
  {
    assert.deepEqual([...fixture.tools.keys()].sort(), [...x_scopedToolNames].sort());
    assert.equal(fixture.tools.has("bash"), false);
    assert.equal(fixture.tools.has("grep"), false);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("read returns numbered excerpts and rejects escapes", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory, outsideDirectory) =>
  {
    await WriteRootFile(rootDirectory, "src/app.ts", "line1\nline2\nline3\n");
    await WriteRootFile(outsideDirectory, "secret.txt", "secret\n");
    await CreateOutsideSymlink(rootDirectory, outsideDirectory, "link.txt", "secret.txt");
  });

  try
  {
    const result = await RunTool(fixture, "read", { path: "src/app.ts", offset: 2, limit: 1 });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /^src\/app\.ts/);
    assert.match(text, /2\|line2/);

    const escape = await RunTool(fixture, "read", { path: "../outside/secret.txt" });
    assert.equal(escape.isError, true);
    assert.equal(fixture.activityEvents.length, 1);
    assert.equal(fixture.activityEvents[0]?.type, "sheaf_chat.path_escape_denied");
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("write creates files under root and reports relative paths", async () =>
{
  const fixture = await CreateScopedTestFixture();

  try
  {
    const result = await RunTool(fixture, "write", {
      path: "nested/new.txt",
      content: "created",
    });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /nested\/new\.txt/);

    const written = await readFile(path.join(fixture.rootDirectory, "nested/new.txt"), "utf-8");
    assert.equal(written, "created");
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("edit applies exact replacement and reports ambiguity failures", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "edit.txt", "alpha\nbeta\nbeta\n");
  });

  try
  {
    const success = await RunTool(fixture, "edit", {
      path: "edit.txt",
      edits: [{ oldText: "alpha", newText: "gamma" }],
    });
    AssertNoAbsoluteLeak(fixture, success.content[0]?.text ?? "");
    const updated = await readFile(path.join(fixture.rootDirectory, "edit.txt"), "utf-8");
    assert.equal(updated, "gamma\nbeta\nbeta\n");

    const ambiguous = await RunTool(fixture, "edit", {
      path: "edit.txt",
      edits: [{ oldText: "beta", newText: "delta" }],
    });
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.content[0]?.text ?? "", /unique/i);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("list reports metadata for directory entries", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "one.txt", "a");
    await WriteRootFile(rootDirectory, "dir/two.txt", "b");
  });

  try
  {
    const result = await RunTool(fixture, "list", { path: "." });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /one\.txt\tfile\t/);
    assert.match(text, /dir\tdir\t/);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("traversal tools do not follow symlink entries outside the root", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory, outsideDirectory) =>
  {
    await WriteRootFile(rootDirectory, "visible.txt", "inside hit\n");
    await WriteRootFile(outsideDirectory, "secret.txt", "outside secret\n");
    await WriteRootFile(outsideDirectory, "vault/hidden.txt", "outside secret\n");
    await CreateOutsideSymlink(rootDirectory, outsideDirectory, "link-file.txt", "secret.txt");
    await CreateOutsideSymlink(rootDirectory, outsideDirectory, "link-dir", "vault");
  });

  try
  {
    const search = await RunTool(fixture, "search_text", {
      pattern: "outside secret",
      literal: true,
    });
    const searchText = search.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, searchText);
    assert.equal(searchText, "(no matches)");

    const find = await RunTool(fixture, "find_files", { glob: "**/*.txt" });
    const findText = find.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, findText);
    assert.match(findText, /visible\.txt/);
    assert.doesNotMatch(findText, /link-file|link-dir|hidden\.txt|secret\.txt/);

    const tree = await RunTool(fixture, "tree", { maxDepth: 4 });
    const treeText = tree.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, treeText);
    assert.match(treeText, /visible\.txt/);
    assert.doesNotMatch(treeText, /link-file|link-dir|hidden\.txt|secret\.txt/);

    const list = await RunTool(fixture, "list", { path: "." });
    const listText = list.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, listText);
    assert.match(listText, /link-file\.txt\tsymlink\t/);
    assert.match(listText, /link-dir\tsymlink\t/);
    assert.doesNotMatch(listText, /hidden\.txt|secret\.txt/);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("tree applies depth and ignore limits", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "src/index.ts", "export {}\n");
    await WriteRootFile(rootDirectory, "node_modules/pkg/index.js", "module\n");
    await WriteRootFile(rootDirectory, "deep/a/b/c.txt", "deep\n");
  });

  try
  {
    const result = await RunTool(fixture, "tree", { maxDepth: 2, maxEntries: 10 });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /src\/index\.ts/);
    assert.doesNotMatch(text, /node_modules/);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("globstar patterns match zero or more path segments", () =>
{
  assert.equal(MatchesGlob("c.json", "**/*.json"), true);
  assert.equal(MatchesGlob("a/c.json", "**/*.json"), true);
  assert.equal(MatchesGlob("a/b/c.json", "**/*.json"), true);
  assert.equal(MatchesGlob("foo", "**/foo"), true);
  assert.equal(MatchesGlob("a/b/foo", "**/foo"), true);
  assert.equal(MatchesGlob("a/b", "a/**/b"), true);
  assert.equal(MatchesGlob("a/x/y/b", "a/**/b"), true);
});

test("find_files supports filters and limits", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "src/a.ts", "a");
    await WriteRootFile(rootDirectory, "src/b.js", "b");
    await WriteRootFile(rootDirectory, "lib/a.ts", "c");
  });

  try
  {
    const result = await RunTool(fixture, "find_files", {
      extension: "ts",
      pathSegment: "src",
      limit: 5,
    });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /src\/a\.ts/);
    assert.doesNotMatch(text, /src\/b\.js/);
    assert.doesNotMatch(text, /lib\/a\.ts/);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("find_files supports globstar glob, include, and exclude filters", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "c.json", "root");
    await WriteRootFile(rootDirectory, "a/c.json", "nested");
    await WriteRootFile(rootDirectory, "a/b/c.json", "deep");
    await WriteRootFile(rootDirectory, "a/b/skip.json", "skip");
    await WriteRootFile(rootDirectory, "a/b/c.ts", "ts");
  });

  try
  {
    const globResult = await RunTool(fixture, "find_files", { glob: "**/*.json" });
    const globText = globResult.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, globText);
    assert.match(globText, /^c\.json$/m);
    assert.match(globText, /^a\/c\.json$/m);
    assert.match(globText, /^a\/b\/c\.json$/m);
    assert.match(globText, /^a\/b\/skip\.json$/m);
    assert.doesNotMatch(globText, /c\.ts/);

    const filtered = await RunTool(fixture, "find_files", {
      include: ["a/**/*.json"],
      exclude: ["**/skip.json"],
    });
    const filteredText = filtered.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, filteredText);
    assert.match(filteredText, /^a\/c\.json$/m);
    assert.match(filteredText, /^a\/b\/c\.json$/m);
    assert.doesNotMatch(filteredText, /^c\.json$/m);
    assert.doesNotMatch(filteredText, /skip\.json/);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("search_text supports regex, context, binary skipping, and match limits", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "src/a.ts", "foo\nbar\nfoo\n");
    await WriteRootFile(rootDirectory, "src/binary.dat", "\0binary\n");
    await WriteRootFile(rootDirectory, "src/many.txt", Array.from({ length: 20 }, (_, index) => `hit ${index}`).join("\n"));
  });

  try
  {
    const result = await RunTool(fixture, "search_text", {
      pattern: "foo",
      literal: true,
      context: 1,
      limit: 3,
    });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /src\/a\.ts:1:foo/);
    assert.match(text, /src\/a\.ts:2:bar/);
    assert.doesNotMatch(text, /binary\.dat/);
    assert.match(text, /reached limit=3/);

    const regex = await RunTool(fixture, "search_text", {
      pattern: "hit \\d+",
      path: "src/many.txt",
      limit: 2,
    });
    assert.match(regex.content[0]?.text ?? "", /src\/many\.txt:/);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("search_text supports globstar include and exclude filters", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "hit.txt", "needle root\n");
    await WriteRootFile(rootDirectory, "src/hit.txt", "needle nested\n");
    await WriteRootFile(rootDirectory, "src/deep/hit.txt", "needle deep\n");
    await WriteRootFile(rootDirectory, "src/skip.txt", "needle skip\n");
    await WriteRootFile(rootDirectory, "src/hit.log", "needle log\n");
  });

  try
  {
    const result = await RunTool(fixture, "search_text", {
      pattern: "needle",
      literal: true,
      include: ["**/*.txt"],
      exclude: ["**/skip.txt"],
    });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /hit\.txt:1:needle root/);
    assert.match(text, /src\/hit\.txt:1:needle nested/);
    assert.match(text, /src\/deep\/hit\.txt:1:needle deep/);
    assert.doesNotMatch(text, /skip\.txt|hit\.log/);
  }
  finally
  {
    await fixture.cleanup();
  }
});

test("file_info returns canonical in-root metadata", async () =>
{
  const fixture = await CreateScopedTestFixture(async (rootDirectory) =>
  {
    await WriteRootFile(rootDirectory, "meta.txt", "hello");
  });

  try
  {
    const result = await RunTool(fixture, "file_info", { path: "meta.txt" });
    const text = result.content[0]?.text ?? "";
    AssertNoAbsoluteLeak(fixture, text);
    assert.match(text, /path: meta\.txt/);
    assert.match(text, /type: file/);
    assert.match(text, /size: 5/);
  }
  finally
  {
    await fixture.cleanup();
  }
});
