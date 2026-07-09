import assert from "node:assert/strict";
import test from "node:test";

test("browser scaffold test runner is active", () => {
  assert.equal(typeof globalThis, "object");
});
