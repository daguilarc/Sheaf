import assert from "node:assert/strict";
import test from "node:test";

import { IsValidIdentityId } from "../src/shared/validation.js";

test("IsValidIdentityId accepts generated path-safe ids and rejects unsafe values", () =>
{
  assert.equal(IsValidIdentityId("repo_123456789012"), true);
  assert.equal(IsValidIdentityId("workspace-123456"), true);
  assert.equal(IsValidIdentityId(""), false);
  assert.equal(IsValidIdentityId("."), false);
  assert.equal(IsValidIdentityId(".."), false);
  assert.equal(IsValidIdentityId("short"), false);
  assert.equal(IsValidIdentityId("bad/name"), false);
  assert.equal(IsValidIdentityId("bad\\name"), false);
});
