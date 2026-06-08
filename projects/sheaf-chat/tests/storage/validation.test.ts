import assert from "node:assert/strict";
import test from "node:test";

import { StorageError } from "../../src/storage/errors.js";
import { ValidatePileName, ValidateSessionId } from "../../src/storage/validation.js";

test("ValidatePileName rejects traversal, reserved names, and invalid stems", () =>
{
  assert.throws(
    () => ValidatePileName(""),
    (error: unknown) => error instanceof StorageError && error.code === "invalid_pile",
  );
  assert.throws(() => ValidatePileName("."), StorageError);
  assert.throws(() => ValidatePileName(".."), StorageError);
  assert.throws(() => ValidatePileName("bad/name"), StorageError);
  assert.throws(() => ValidatePileName("bad\\name"), StorageError);
  assert.throws(() => ValidatePileName("-leading-dash"), StorageError);
});

test("ValidatePileName rejects Unicode normalization differences", () =>
{
  const nfdName = "e\u0301team";
  const nfcName = nfdName.normalize("NFC");

  assert.notEqual(nfdName, nfcName);
  assert.throws(
    () => ValidatePileName(nfdName),
    (error: unknown) => error instanceof StorageError && error.code === "invalid_name",
  );
  assert.equal(ValidatePileName(`a${nfcName.slice(1)}`), `a${nfcName.slice(1)}`);
});

test("ValidateSessionId accepts generated ids and rejects unsafe values", () =>
{
  assert.equal(ValidateSessionId("01Jabc"), "01Jabc");
  assert.throws(() => ValidateSessionId(".."), StorageError);
  assert.throws(() => ValidateSessionId("bad/name"), StorageError);
});
