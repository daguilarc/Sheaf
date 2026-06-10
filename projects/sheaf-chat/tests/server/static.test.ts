import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import test from "node:test";

import {
  BuildSheafChatStaticRoots,
  BuildVendorAssetAllowlist,
  ResolveSheafChatIndexPath,
  ResolveStaticFile,
  x_aguiChatCssPath,
  x_aguiChatJsPath,
  x_katexCssPath,
  x_katexFontsUrlPrefix,
  x_katexJsPath,
  x_markdownItJsPath,
  x_sheafChatCssPath,
  x_sheafChatJsPath,
  x_sheafMarkdownJsPath,
} from "../../src/server/static.js";
import { FindRepositoryRoot } from "../../src/server/repo_paths.js";
import { StartTestServer } from "./rest/helpers.js";

function ResolveCssUrl(stylesheetPath: string, cssUrl: string): string
{
  if (cssUrl.startsWith("/"))
  {
    return posix.normalize(cssUrl);
  }

  return posix.normalize(posix.join(posix.dirname(stylesheetPath), cssUrl));
}

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

test("vendor allowlist resolves markdown-it, katex, and font assets", () =>
{
  const repoRoot = FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  const roots = BuildSheafChatStaticRoots(repoRoot);
  const vendorAllowlist = BuildVendorAssetAllowlist(repoRoot);
  const markdownIt = ResolveStaticFile(x_markdownItJsPath, roots, vendorAllowlist);
  const katexJs = ResolveStaticFile(x_katexJsPath, roots, vendorAllowlist);
  const katexCss = ResolveStaticFile(x_katexCssPath, roots, vendorAllowlist);

  assert.ok(markdownIt);
  assert.ok(katexJs);
  assert.ok(katexCss);
  assert.match(markdownIt!.absolutePath, /markdown-it\.min\.js$/);
  assert.match(katexJs!.absolutePath, /katex\.min\.js$/);

  const fontEntry = [...vendorAllowlist.entries()].find(([urlPath]) =>
    urlPath.startsWith(x_katexFontsUrlPrefix + "/"),
  );
  assert.ok(fontEntry);
  const fontResolved = ResolveStaticFile(fontEntry![0], roots, vendorAllowlist);
  assert.ok(fontResolved);
  assert.match(fontResolved!.absolutePath, /KaTeX_.*\.(woff2|woff|ttf)$/);
});

test("KaTeX stylesheet font references resolve to served font assets", () =>
{
  const repoRoot = FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  const roots = BuildSheafChatStaticRoots(repoRoot);
  const vendorAllowlist = BuildVendorAssetAllowlist(repoRoot);
  const katexCss = ResolveStaticFile(x_katexCssPath, roots, vendorAllowlist);

  assert.ok(katexCss);

  const cssText = readFileSync(katexCss!.absolutePath, "utf8");
  const urlMatch = /url\((?:'|")?([^)'"]+\.(?:woff2|woff|ttf))(?:'|")?\)/.exec(cssText);

  assert.ok(urlMatch);

  const resolvedFontPath = ResolveCssUrl(x_katexCssPath, urlMatch![1]);
  const fontResolved = ResolveStaticFile(resolvedFontPath, roots, vendorAllowlist);

  assert.ok(fontResolved);
  assert.match(fontResolved!.contentType, /^font\//);
});

test("vendor routes reject path traversal", () =>
{
  const repoRoot = FindRepositoryRoot();

  if (repoRoot === undefined)
  {
    throw new Error("repository root not found");
  }

  const roots = BuildSheafChatStaticRoots(repoRoot);
  const vendorAllowlist = BuildVendorAssetAllowlist(repoRoot);

  assert.equal(
    ResolveStaticFile(`${x_katexFontsUrlPrefix}/../markdown-it.min.js`, roots, vendorAllowlist),
    undefined,
  );
  assert.equal(
    ResolveStaticFile("/assets/vendor/../../sheaf-chat/sheaf-chat.js", roots, vendorAllowlist),
    undefined,
  );
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
    assert.match(mainHtml, /markdown-it\.min\.js/);
    assert.match(mainHtml, /katex\.min\.js/);
    assert.match(mainHtml, /sheaf-markdown\.js/);
    assert.match(mainHtml, /agui-chat\.js/);
    assert.match(mainHtml, /sheaf-chat\.js/);

    const markdownIt = await fetch(`${handle.baseUrl}${x_markdownItJsPath}`);
    assert.equal(markdownIt.status, 200);
    assert.match(markdownIt.headers.get("content-type") ?? "", /javascript/);

    const sheafMarkdown = await fetch(`${handle.baseUrl}${x_sheafMarkdownJsPath}`);
    assert.equal(sheafMarkdown.status, 200);
    assert.match(await sheafMarkdown.text(), /renderMarkdown/);

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
