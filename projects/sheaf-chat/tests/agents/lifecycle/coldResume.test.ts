import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { AgentManager } from "../../../src/agents/manager.js";
import { AgentLifecycleState } from "../../../src/shared/types.js";
import { CreatePile } from "../../../src/storage/piles.js";
import {
  CreateStorage,
  CreateTestConfigWithRoot,
  CreateTestModelBundle,
  FakePiSession,
  WriteColdResumeFixture,
  WithFakeRepoAsync,
} from "./helpers.js";

test("attachSession cold-resumes from manifest and pi jsonl fixture", async () =>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const config = CreateTestConfigWithRoot(repoRoot);
    const storagePaths = CreateStorage(repoRoot);
    const modelBundle = CreateTestModelBundle();
    const model = modelBundle.modelRegistry.getAll().find((entry) => entry.provider === "openai");
    assert.ok(model);
    const modelRef = { provider: model.provider, id: model.id };
    const rootDirectory = path.join(repoRoot, "projects", "demo");
    const sessionId = "a1b2c3d4e5f6789012345678abcdef01";

    await CreatePile(storagePaths, "default");
    const fixture = WriteColdResumeFixture(
      repoRoot,
      "default",
      sessionId,
      rootDirectory,
      modelRef,
    );

    const fakeSessions = new Map<string, FakePiSession>();
    const manager = await AgentManager.Create({
      config,
      storagePaths,
      modelBundle,
      createPiSession: async (input) =>
      {
        assert.equal(input.sessionFilePath, fixture.sessionFilePath);
        assert.equal(input.coldResume, true);
        assert.equal(input.rootDirectory, rootDirectory);

        const fake = new FakePiSession(sessionId, input.sessionFilePath, input.model);
        fakeSessions.set(input.sessionFilePath, fake);
        return fake;
      },
    });

    const status = await manager.attachSession("default", sessionId, "client-a");

    assert.equal(status.state, AgentLifecycleState.Active);
    assert.equal(status.manifestPresent, true);
    assert.equal(status.manifest?.chatName, "Cold resume chat");
    assert.equal(fakeSessions.size, 1);
  });
});
