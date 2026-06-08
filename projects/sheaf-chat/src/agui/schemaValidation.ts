import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AjvModule from "ajv";

import type { AguiEvent } from "./types.js";

const Ajv = AjvModule.default ?? AjvModule;

let m_schemaPromise: Promise<Record<string, unknown>> | undefined;
let m_validatorPromise: Promise<(event: AguiEvent) => boolean> | undefined;

async function FindRepoRoot(startDirectory: string): Promise<string>
{
  let current = path.resolve(startDirectory);

  while (true)
  {
    const candidate = path.join(current, "structure", "schemas", "ag_ui_events.schema.json");

    try
    {
      await access(candidate);
      return current;
    }
    catch
    {
      const parent = path.dirname(current);

      if (parent === current)
      {
        throw new Error("could not locate ag_ui_events.schema.json from repository root");
      }

      current = parent;
    }
  }
}

export async function ResolveAguiSchemaPath(): Promise<string>
{
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = await FindRepoRoot(moduleDirectory);
  return path.join(repoRoot, "structure", "schemas", "ag_ui_events.schema.json");
}

export async function LoadAguiEventSchema(): Promise<Record<string, unknown>>
{
  if (m_schemaPromise === undefined)
  {
    m_schemaPromise = (async () =>
    {
      const schemaPath = await ResolveAguiSchemaPath();
      const raw = await readFile(schemaPath, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    })();
  }

  return m_schemaPromise;
}

export async function CreateAguiEventValidator(): Promise<(event: AguiEvent) => boolean>
{
  if (m_validatorPromise === undefined)
  {
    m_validatorPromise = (async () =>
    {
      const schema = await LoadAguiEventSchema();
      const ajv = new Ajv({
        allErrors: true,
        strict: false,
        validateSchema: false,
      });
      const validate = ajv.compile(schema);

      return (event: AguiEvent) =>
      {
        return validate(event) === true;
      };
    })();
  }

  return m_validatorPromise;
}

export async function ValidateAguiEvent(event: AguiEvent): Promise<void>
{
  const validate = await CreateAguiEventValidator();

  if (!validate(event))
  {
    throw new Error(`AGUI event failed schema validation: ${event.type}`);
  }
}
