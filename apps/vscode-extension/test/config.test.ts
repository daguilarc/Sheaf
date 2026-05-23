import assert from "node:assert/strict";
import { test } from "node:test";

import { ResolveOpenAiApiKey } from "../src/configCore.js";

test("ResolveOpenAiApiKey prefers SecretStorage over setting over env", () =>
{
  assert.equal(
    ResolveOpenAiApiKey("secret", "setting", "env"),
    "secret",
  );
  assert.equal(ResolveOpenAiApiKey(undefined, "setting", "env"), "setting");
  assert.equal(ResolveOpenAiApiKey(undefined, "", "env"), "env");
  assert.equal(ResolveOpenAiApiKey(undefined, undefined, "  "), undefined);
});

test("ResolveOpenAiApiKey ignores blank higher-priority values", () =>
{
  assert.equal(ResolveOpenAiApiKey("   ", "setting", undefined), "setting");
  assert.equal(ResolveOpenAiApiKey(undefined, "  \t", "env"), "env");
});
