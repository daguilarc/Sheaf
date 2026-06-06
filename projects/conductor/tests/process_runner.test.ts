import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { serviceLogStreamPaths, spawnCommand } from "../src/index.js";

test("serviceLogStreamPaths resolves stdout and stderr log files", () =>
{
  const paths = serviceLogStreamPaths("/repo", "alpha");

  assert.equal(paths.logDir, "/repo/logs/alpha");
  assert.equal(paths.stdoutPath, "/repo/logs/alpha/alpha_stdout.log");
  assert.equal(paths.stderrPath, "/repo/logs/alpha/alpha_stderr.log");
});

test("spawnCommand streams child stdout and stderr into service log files", async () =>
{
  const repoRoot = await mkdtemp(join(tmpdir(), "conductor-process-runner-"));
  const serviceName = "alpha";
  const logPaths = serviceLogStreamPaths(repoRoot, serviceName);

  try
  {
    const process = spawnCommand(
      "node -e \"console.log('stdout-line'); console.error('stderr-line')\"",
      repoRoot,
      serviceName,
      repoRoot,
    );

    assert.ok(process.pid > 0);

    await new Promise((resolve) =>
    {
      setTimeout(resolve, 500);
    });

    const stdoutLog = await readFile(logPaths.stdoutPath, "utf8");
    const stderrLog = await readFile(logPaths.stderrPath, "utf8");

    assert.match(stdoutLog, /stdout-line/);
    assert.match(stderrLog, /stderr-line/);
  }
  finally
  {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
