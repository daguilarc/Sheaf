import type { InputError, UserInputCommand } from "./events.js";

export type ParsedInputLine = UserInputCommand | InputError;

export function parseInputLine(line: string): ParsedInputLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return {
      type: "error",
      code: "invalid_input_json",
      message: "Input line must be valid JSON.",
    };
  }

  if (!isRecord(value) || typeof value.type !== "string") {
    return {
      type: "error",
      code: "invalid_input_command",
      message: "Input command must be a JSON object with a string type.",
    };
  }

  if (value.type === "control.exit") {
    const keys = Object.keys(value);
    if (keys.length !== 1) {
      return {
        type: "error",
        code: "invalid_input_command",
        message: "control.exit does not accept additional fields.",
      };
    }
    return { type: "control.exit" };
  }

  if (value.type === "user.message") {
    const allowedKeys = new Set(["type", "text", "metadata"]);
    const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.has(key));
    if (unsupportedKey !== undefined) {
      return {
        type: "error",
        code: "invalid_input_command",
        message: `Unsupported field for user.message: ${unsupportedKey}.`,
      };
    }

    if (typeof value.text !== "string" || value.text.length === 0) {
      return {
        type: "error",
        code: "invalid_user_message",
        message: "user.message requires a non-empty text string.",
      };
    }

    if (value.metadata !== undefined && !isRecord(value.metadata)) {
      return {
        type: "error",
        code: "invalid_input_command",
        message: "user.message metadata must be an object when provided.",
      };
    }

    return value.metadata === undefined
      ? { type: "user.message", text: value.text }
      : { type: "user.message", text: value.text, metadata: value.metadata };
  }

  return {
    type: "error",
    code: "unsupported_input_command",
    message: `Unsupported input command: ${value.type}.`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
