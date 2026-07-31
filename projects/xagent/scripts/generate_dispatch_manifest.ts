import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JoinDescribeSlots,
  type DescribeSlotsDoc,
  type GeneratedManifest,
} from "../src/service/dispatch_manifest.ts";

const x_Here = path.dirname(fileURLToPath(import.meta.url));
const x_XagentRoot = path.resolve(x_Here, "..");
const x_RepoRoot = path.resolve(x_XagentRoot, "..", "..");
const x_Renderer = path.join(x_RepoRoot, "projects", "agents", "utils", "dispatch-prompt");
const x_Output = path.join(
  x_XagentRoot,
  "src",
  "service",
  "dispatch_manifest.generated.json",
);

function LoadDescribeSlots(): DescribeSlotsDoc {
  const stdout = execFileSync("python3", [x_Renderer, "--describe-slots"], {
    encoding: "utf8",
    cwd: x_RepoRoot,
  });
  const doc = JSON.parse(stdout) as DescribeSlotsDoc;
  if (doc.schema_version !== 1) {
    throw new Error(
      `unsupported dispatch-prompt --describe-slots schema_version: ${doc.schema_version}`,
    );
  }
  return doc;
}

function BuildGenerated(): GeneratedManifest {
  const entries = JoinDescribeSlots(LoadDescribeSlots());
  return { schema_version: 1, entries };
}

function Format(doc: GeneratedManifest): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function Main(): void {
  const check = process.argv.includes("--check");
  const generated = Format(BuildGenerated());
  if (check) {
    let existing = "";
    try {
      existing = readFileSync(x_Output, "utf8");
    }
    catch {
      throw new Error(
        `checked-in dispatch manifest missing at ${x_Output}; run without --check to generate`,
      );
    }
    if (existing !== generated) {
      throw new Error(
        "dispatch_manifest.generated.json is stale; re-run "
        + "scripts/generate_dispatch_manifest.ts and commit the result",
      );
    }
    process.stdout.write(`dispatch manifest is current: ${x_Output}\n`);
    return;
  }
  writeFileSync(x_Output, generated);
  process.stdout.write(`wrote ${x_Output}\n`);
}

Main();
