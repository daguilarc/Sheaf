import assert from "node:assert/strict";
import test from "node:test";

import { FormatRestError } from "../src/shared/errors.js";

test("FormatRestError returns stable REST error envelope", () =>
{
  const body = FormatRestError("not_found", "session not found");

  assert.deepEqual(body, {
    error: {
      code: "not_found",
      message: "session not found",
    },
  });
});
