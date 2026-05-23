import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { ResolveWorkspacePath } from "../../src/tools/pathPolicy.js";

function IsOk(
  r: import("../../src/tools/pathPolicy.js").ResolveWorkspacePathResult,
): r is import("../../src/tools/pathPolicy.js").ResolveWorkspacePathOk
{
  return !("code" in r);
}

test("ResolveWorkspacePath trims and resolves relative paths", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-pp-"));
  try
  {
    const inner = path.join(tmp, "proj");
    fs.mkdirSync(path.join(inner, "src"), { recursive: true });
    fs.writeFileSync(path.join(inner, "src", "a.ts"), "// hi\n");
    const r = ResolveWorkspacePath("src/a.ts", [inner]);
    assert.ok(IsOk(r));
    assert.equal(r.relativePosix.replace(/\\/g, "/"), "src/a.ts");
    assert.ok(r.absPath.endsWith(path.join("src", "a.ts")));
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ResolveWorkspacePath rejects traversal outside workspace", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-pp2-"));
  try
  {
    const r = ResolveWorkspacePath("../outside", [tmp]);
    assert.ok(!IsOk(r));
    assert.equal(r.code, "path_outside_workspace");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ResolveWorkspacePath empty path is file_not_found", () =>
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sheaf-pp3-"));
  try
  {
    const r = ResolveWorkspacePath("   ", [tmp]);
    assert.ok(!IsOk(r));
    assert.equal(r.code, "file_not_found");
  }
  finally
  {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ResolveWorkspacePath with no roots is path_outside_workspace", () =>
{
  const r = ResolveWorkspacePath("a", []);
  assert.ok(!IsOk(r));
  assert.equal(r.code, "path_outside_workspace");
});
