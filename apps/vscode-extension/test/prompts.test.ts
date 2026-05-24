import assert from "node:assert/strict";
import { test } from "node:test";

import { ResolveSystemPrompt } from "../src/configCore.js";
import { BASELINE_VOICE_NAV_SYSTEM_PROMPT } from "../src/prompts.js";

test("built-in prompt names sheaf VS Code toolset", () =>
{
  assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /sheaf VS Code/);
});

test("built-in prompt documents modifyFile and exact context validation", () =>
{
  assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /modifyFile/);
  assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /exactText/);
  assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /contextBeforeText/);
  assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /contextAfterText/);
});

test("ResolveSystemPrompt returns built-in prompt when configured prompt is empty", () =>
{
  assert.equal(ResolveSystemPrompt(undefined), BASELINE_VOICE_NAV_SYSTEM_PROMPT);
  assert.equal(ResolveSystemPrompt(""), BASELINE_VOICE_NAV_SYSTEM_PROMPT);
  assert.equal(ResolveSystemPrompt("  \t"), BASELINE_VOICE_NAV_SYSTEM_PROMPT);
  assert.match(ResolveSystemPrompt(undefined), /sheaf VS Code/);
});

test("ResolveSystemPrompt overrides built-in prompt when configured prompt is non-empty", () =>
{
  assert.equal(ResolveSystemPrompt("custom prompt"), "custom prompt");
  assert.doesNotMatch(ResolveSystemPrompt("custom prompt"), /sheaf VS Code/);
});
