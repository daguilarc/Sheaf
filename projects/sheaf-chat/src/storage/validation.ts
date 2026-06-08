import {
  IsValidPileName,
  IsValidSessionId,
  x_pileNamePattern,
  x_sessionIdPattern,
} from "../shared/validation.js";
import { StorageError } from "./errors.js";

export { x_pileNamePattern, x_sessionIdPattern };

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

export function ValidatePileName(name: string): string
{
  AssertNormalizedStem(name, "pile name");

  if (!IsValidPileName(name))
  {
    throw new StorageError(
      "invalid_pile",
      "pile name must be a safe single path segment",
    );
  }

  return name;
}

export function ValidateSessionId(sessionId: string): string
{
  AssertNormalizedStem(sessionId, "session id");

  if (!IsValidSessionId(sessionId))
  {
    throw new StorageError(
      "invalid_session_id",
      "session id must be a safe single path segment",
    );
  }

  return sessionId;
}
