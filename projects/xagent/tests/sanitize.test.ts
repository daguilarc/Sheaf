import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeValue } from "../src/sanitize.js";

test("sanitization does not redact token count fields", () => {
  const sanitized = sanitizeValue(
    {
      usage: {
        total_tokens: 123,
        completion_tokens: 45,
        token_count: 67,
      },
    },
    "/repo",
  );

  assert.deepEqual(sanitized, {
    usage: {
      total_tokens: 123,
      completion_tokens: 45,
      token_count: 67,
    },
  });
});

test("sanitization redacts separator-aware secret keys", () => {
  const sanitized = sanitizeValue(
    {
      token: "abc123",
      access_token: "def456",
      apiKey: "ghi789",
      openai_api_key: "jkl012",
      client_secret_value: "mno345",
      service_password: "pqr678",
      nested: {
        password: "secret",
      },
    },
    "/repo",
  );

  assert.deepEqual(sanitized, {
    token: "[REDACTED]",
    access_token: "[REDACTED]",
    apiKey: "[REDACTED]",
    openai_api_key: "[REDACTED]",
    client_secret_value: "[REDACTED]",
    service_password: "[REDACTED]",
    nested: {
      password: "[REDACTED]",
    },
  });
});

test("sanitization redacts quoted JSON secret string forms", () => {
  const sanitized = sanitizeValue(
    '{"token":"abc123","total_tokens":123,"openai_api_key":"sk-testsecret","token_count":12}',
    "/repo",
  );

  assert.equal(
    sanitized,
    '{"token":"[REDACTED]","total_tokens":123,"openai_api_key":"[REDACTED]","token_count":12}',
  );
});

test("path relativization only rewrites paths inside repo root", () => {
  const sanitized = sanitizeValue(
    {
      inside: "/repo/src/index.ts",
      outsidePrefix: "/repo-backup/src/index.ts",
      sentence: "read /repo/src/index.ts not /repo-backup/src/index.ts",
    },
    "/repo",
  );

  assert.deepEqual(sanitized, {
    inside: "./src/index.ts",
    outsidePrefix: "/repo-backup/src/index.ts",
    sentence: "read ./src/index.ts not /repo-backup/src/index.ts",
  });
});
