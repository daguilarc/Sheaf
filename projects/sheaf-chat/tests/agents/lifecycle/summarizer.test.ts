import assert from "node:assert/strict";
import test from "node:test";

import {
  BuildDeterministicSummary,
  CreateSessionSummarizer,
} from "../../../src/agents/summarizer.js";

test("BuildDeterministicSummary truncates the first line", () =>
{
  const longLine = "a".repeat(120);
  const summary = BuildDeterministicSummary(longLine, 40);

  assert.equal(summary.chatName.length, 40);
  assert.equal(summary.description.length, 40);
  assert.match(summary.chatName, /…$/u);
});

test("CreateSessionSummarizer falls back when generation fails", async () =>
{
  const summarizer = CreateSessionSummarizer({
    generate: async () =>
    {
      throw new Error("summarizer offline");
    },
  });

  const summary = await summarizer("Fix the login redirect bug in auth.ts");

  assert.equal(summary.chatName, "Fix the login redirect bug in auth.ts");
  assert.equal(summary.description, summary.chatName);
});
