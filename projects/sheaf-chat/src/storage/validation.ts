import {
  IsValidIdentityId,
  x_identityIdPattern,
} from "../shared/validation.js";
import { StorageError } from "./errors.js";

export { x_identityIdPattern };

function AssertNormalizedStem(value: string, label: string): void
{
  const normalized = value.normalize("NFC");

  if (value !== normalized)
  {
    throw new StorageError(
      "invalid_name",
      `${label} must use Unicode NFC normalization`,
    );
  }
}

export function ValidateIdentityId(id: string, label = "id"): string
{
  AssertNormalizedStem(id, label);

  if (!IsValidIdentityId(id))
  {
    throw new StorageError(
      "invalid_id",
      `${label} must be a safe generated identifier`,
    );
  }

  return id;
}

export function ValidateRepoId(repoId: string): string
{
  return ValidateIdentityId(repoId, "repoId");
}

export function ValidateWorkspaceId(workspaceId: string): string
{
  return ValidateIdentityId(workspaceId, "workspaceId");
}

export function ValidateChatId(chatId: string): string
{
  return ValidateIdentityId(chatId, "chatId");
}
