import assert from "node:assert/strict";
import test from "node:test";

import { CreateAguiEventValidator, LoadAguiEventSchema } from "../../src/agui/schemaValidation.js";
import { mapUserMessageToAgui } from "../../src/agui/mapper.js";

test("LoadAguiEventSchema loads repository AGUI schema", async () =>
{
  const schema = await LoadAguiEventSchema();

  assert.equal(schema.description, "JSON Schema representation of the AGUI TypeScript/Zod event format from @ag-ui/core. The top-level event is a tagged union discriminated by the type property.");
  assert.ok(Array.isArray(schema.oneOf));
});

test("CreateAguiEventValidator validates supported AGUI event types", async () =>
{
  const validate = await CreateAguiEventValidator();
  const events = mapUserMessageToAgui({ messageId: "user-1", text: "hello" });

  for (const event of events)
  {
    assert.equal(validate(event), true, `expected ${event.type} to validate`);
  }
});
