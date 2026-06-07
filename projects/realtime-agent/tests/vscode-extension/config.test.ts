import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ResolveOpenAiApiKey,
  x_missingOpenAiApiKeyMessage,
} from "../../src/vscode-extension/src/configCore.js";

test("ResolveOpenAiApiKey prefers Secret Storage over repo config over setting", () =>
{
  assert.equal(
    ResolveOpenAiApiKey({
      secretValue: "secret",
      repoConfigValue: "repo",
      settingValue: "setting",
    }),
    "secret",
  );
  assert.equal(
    ResolveOpenAiApiKey({
      repoConfigValue: "repo",
      settingValue: "setting",
    }),
    "repo",
  );
  assert.equal(
    ResolveOpenAiApiKey({
      settingValue: "setting",
    }),
    "setting",
  );
  assert.equal(
    ResolveOpenAiApiKey({
      settingValue: "  ",
    }),
    undefined,
  );
});

test("ResolveOpenAiApiKey ignores blank higher-priority values", () =>
{
  assert.equal(
    ResolveOpenAiApiKey({
      secretValue: "   ",
      repoConfigValue: "repo",
      settingValue: "setting",
    }),
    "repo",
  );
  assert.equal(
    ResolveOpenAiApiKey({
      repoConfigValue: "  \t",
      settingValue: "setting",
    }),
    "setting",
  );
});

test("missing API key message names Secret Storage, api_keys.json, and compatibility setting", () =>
{
  assert.ok(x_missingOpenAiApiKeyMessage.includes("Secret Storage"));
  assert.ok(x_missingOpenAiApiKeyMessage.includes("config/api_keys.json"));
  assert.ok(x_missingOpenAiApiKeyMessage.includes("sheaf.realtime.openAiApiKey"));
  assert.ok(!x_missingOpenAiApiKeyMessage.includes("OPENAI_API_KEY"));
});
