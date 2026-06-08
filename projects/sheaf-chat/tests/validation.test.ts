import assert from "node:assert/strict";
import test from "node:test";

import { IsValidPileName, IsValidSessionId } from "../src/shared/validation.js";

test("IsValidPileName accepts safe pile names and rejects unsafe values", () =>
{
  assert.equal(IsValidPileName("default"), true);
  assert.equal(IsValidPileName("team.alpha"), true);
  assert.equal(IsValidPileName(""), false);
  assert.equal(IsValidPileName("."), false);
  assert.equal(IsValidPileName(".."), false);
  assert.equal(IsValidPileName("bad/name"), false);
  assert.equal(IsValidPileName("-starts-with-dash"), false);
});

test("IsValidSessionId accepts safe session ids and rejects unsafe values", () =>
{
  assert.equal(IsValidSessionId("01Jabc"), true);
  assert.equal(IsValidSessionId("session_1"), true);
  assert.equal(IsValidSessionId(""), false);
  assert.equal(IsValidSessionId(".."), false);
  assert.equal(IsValidSessionId("bad\\name"), false);
});
