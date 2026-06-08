import assert from "node:assert/strict";
import test from "node:test";

import {
  BuildSheafChatStaticRoots,
  ResolveSheafChatIndexPath,
  ResolveStaticFile,
  x_aguiChatCssPath,
  x_aguiChatJsPath,
  x_sheafChatCssPath,
  x_sheafChatJsPath,
} from "../../src/server/static.js";
import { FindRepositoryRoot } from "../../src/server/repo_paths.js";
import { StartTestServer } from "./rest/helpers.js";

test("static roots resolve bundled UI and shared AGUI assets", () =>
{
  const repoRoot = FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  const roots = BuildSheafChatStaticRoots(repoRoot);
  const aguiJs = ResolveStaticFile(x_aguiChatJsPath, roots);
  const aguiCss = ResolveStaticFile(x_aguiChatCssPath, roots);
  const sheafCss = ResolveStaticFile(x_sheafChatCssPath, roots);
  const sheafJs = ResolveStaticFile(x_sheafChatJsPath, roots);

  assert.ok(aguiJs);
  assert.ok(aguiCss);
  assert.ok(sheafCss);
  assert.ok(sheafJs);
  assert.match(aguiJs!.absolutePath, /agui-chat\.js$/);
  assert.match(sheafJs!.absolutePath, /sheaf-chat\.js$/);
  assert.ok(ResolveSheafChatIndexPath(repoRoot).endsWith("index.html"));
});

test("GET / serves the browser UI shell and static assets", async () =>
{
  const repoRoot = FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  const handle = await StartTestServer(repoRoot);

  try
  {
    const mainPage = await fetch(`${handle.baseUrl}/`);
    const mainHtml = await mainPage.text();
    assert.equal(mainPage.status, 200);
    assert.match(mainPage.headers.get("content-type") ?? "", /text\/html/);
    assert.match(mainHtml, /agui-chat\.js/);
    assert.match(mainHtml, /sheaf-chat\.js/);

    const css = await fetch(`${handle.baseUrl}${x_sheafChatCssPath}`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.match(await css.text(), /--sheaf-chat-touch/);

    const js = await fetch(`${handle.baseUrl}${x_sheafChatJsPath}`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
    assert.match(await js.text(), /RenderPilesScreen/);
  }
  finally
  {
    await handle.close();
  }
});
