import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildConductorStaticRoots,
  matchLogsPagePath,
  renderLogsPageHtml,
  renderMainPageHtml,
  resolveBrowserHomeUrl,
  resolveStaticFile,
  x_LogsJsAssetPath,
  x_MainJsAssetPath,
  x_SharedCssAssetPath,
} from "../src/index.js";
import { createRepoPaths } from "../src/paths.js";

test("resolveBrowserHomeUrl rewrites 0.0.0.0 to the page hostname", () =>
{
  assert.equal(
    resolveBrowserHomeUrl("http://0.0.0.0:9001/", "127.0.0.1"),
    "http://127.0.0.1:9001/",
  );
  assert.equal(
    resolveBrowserHomeUrl("http://127.0.0.1:9102/beta", "127.0.0.1"),
    "http://127.0.0.1:9102/beta",
  );
});

test("matchLogsPagePath extracts the service name", () =>
{
  assert.equal(matchLogsPagePath("/services/alpha/logs"), "alpha");
  assert.equal(matchLogsPagePath("/services/with%20space/logs"), "with space");
  assert.equal(matchLogsPagePath("/api/services/alpha/logs"), null);
});

test("main page HTML references shared CSS and project JavaScript", () =>
{
  const html = renderMainPageHtml();

  assert.match(html, new RegExp(`href="${x_SharedCssAssetPath}"`));
  assert.match(html, new RegExp(`src="${x_MainJsAssetPath}"`));
  assert.match(html, /id="services-table"/);
});

test("logs page HTML references shared CSS and logs JavaScript without file paths", () =>
{
  const html = renderLogsPageHtml("alpha");

  assert.match(html, new RegExp(`href="${x_SharedCssAssetPath}"`));
  assert.match(html, new RegExp(`src="${x_LogsJsAssetPath}"`));
  assert.match(html, /"alpha"/);
  assert.doesNotMatch(html, /server\.log/);
  assert.doesNotMatch(html, /logs\/alpha/);
});

test("resolveStaticFile serves known asset roots and rejects traversal", () =>
{
  const paths = createRepoPaths();
  const roots = buildConductorStaticRoots(paths.repoRoot);

  const css = resolveStaticFile(x_SharedCssAssetPath, roots);
  assert.ok(css);
  assert.match(css.absolutePath, /sheaf\.css$/);

  const mainJs = resolveStaticFile(x_MainJsAssetPath, roots);
  assert.ok(mainJs);
  assert.match(mainJs.absolutePath, /main\.js$/);

  assert.equal(resolveStaticFile("/assets/web/../package.json", roots), undefined);
  assert.equal(resolveStaticFile("/assets/unknown/file.txt", roots), undefined);
});

test("shared log view CSS keeps scrollback loading reachable", async () =>
{
  const paths = createRepoPaths();
  const css = await readFile(
    `${paths.repoRoot}/projects/web/src/sheaf.css`,
    "utf8",
  );
  const logViewBlock = css.match(/\.sheaf-log-view\s*\{(?<rules>[^}]*)\}/);

  assert.ok(logViewBlock?.groups?.rules);
  assert.match(logViewBlock.groups.rules, /max-height:\s*[^;]+;/);
  assert.match(logViewBlock.groups.rules, /overflow:\s*auto;/);
});

test("browser JavaScript uses API and WebSocket paths without query-string file paths", async () =>
{
  const paths = createRepoPaths();
  const mainJs = await readFile(
  `${paths.repoRoot}/projects/conductor/src/ui/main.js`,
  "utf8",
  );
  const logsJs = await readFile(
  `${paths.repoRoot}/projects/conductor/src/ui/logs.js`,
  "utf8",
  );

  assert.match(mainJs, /fetch\("\/api\/services"\)/);
  assert.match(mainJs, /\/api\/services\/\$\{encodeURIComponent\(serviceName\)\}\/\$\{action\}/);
  assert.match(mainJs, /method: "POST"/);
  assert.match(mainJs, /createActionButton\("Start"/);
  assert.match(mainJs, /createActionButton\("Stop"/);
  assert.match(mainJs, /createActionButton\("Restart"/);
  assert.match(logsJs, /\/api\/services\/\$\{encodeURIComponent\(serviceName\)\}\/logs/);
  assert.match(logsJs, /\/api\/services\/\$\{encodeURIComponent\(serviceName\)\}\/logs\/stream/);
  assert.match(logsJs, /type:\s*"open"/);
  assert.match(logsJs, /tail_bytes:\s*65536/);
  assert.match(logsJs, /type:\s*"read_before"/);
  assert.match(logsJs, /type:\s*"follow"/);
  assert.doesNotMatch(logsJs, /\?file=/);
});
