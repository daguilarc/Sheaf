import assert from "node:assert/strict";
import test from "node:test";

import { StorageError } from "../../src/storage/errors.js";
import {
  ValidateChatId,
  ValidateRepoId,
  ValidateWorkspaceId,
} from "../../src/storage/validation.js";

test("ValidateIdentityId wrappers reject traversal, reserved names, and invalid ids", () =>
{
  assert.throws(
    () => ValidateRepoId(""),
    (error: unknown) => error instanceof StorageError && error.code === "invalid_id",
  );
  assert.throws(() => ValidateWorkspaceId("."), StorageError);
  assert.throws(() => ValidateChatId(".."), StorageError);
  assert.throws(() => ValidateRepoId("bad/name"), StorageError);
  assert.throws(() => ValidateWorkspaceId("bad\\name"), StorageError);
  assert.throws(() => ValidateChatId("short"), StorageError);
});

test("ValidateIdentityId wrappers reject Unicode normalization differences", () =>
{
  const nfdName = "repo_12345678901e\u0301";
  const nfcName = nfdName.normalize("NFC");

  assert.notEqual(nfdName, nfcName);
  assert.throws(
    () => ValidateRepoId(nfdName),
    (error: unknown) => error instanceof StorageError && error.code === "invalid_name",
  );
  assert.throws(
    () => ValidateRepoId(nfcName),
    (error: unknown) => error instanceof StorageError && error.code === "invalid_id",
  );
});
