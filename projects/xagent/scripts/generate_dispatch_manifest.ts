import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  JoinDescribeSlots,
  x_VariantTemplates,
  type DescribeSlotsDoc,
  type GeneratedManifest,
  type ManifestEntry,
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

function EntryKey(entry: ManifestEntry): string {
  return `${entry.variant}\0${entry.rendererOption ?? ""}\0${entry.provenance}`;
}

function DescribeEntry(entry: ManifestEntry): string {
  const template = x_VariantTemplates[entry.variant];
  const templateLabel = template === null || template === undefined
    ? "service-formatted"
    : `template ${template}`;
  const option = entry.rendererOption ?? "(no renderer option)";
  return `${entry.variant} ${option} provenance=${entry.provenance} (${templateLabel})`;
}

function DescribeDivergence(
  existing: GeneratedManifest,
  generated: GeneratedManifest,
): string[] {
  const lines: string[] = [];
  const existingByKey = new Map(existing.entries.map((e) => [EntryKey(e), e]));
  const generatedByKey = new Map(generated.entries.map((e) => [EntryKey(e), e]));

  for (const [key, entry] of generatedByKey) {
    if (!existingByKey.has(key)) {
      lines.push(`added: ${DescribeEntry(entry)}`);
    }
  }
  for (const [key, entry] of existingByKey) {
    if (!generatedByKey.has(key)) {
      lines.push(`removed: ${DescribeEntry(entry)}`);
    }
  }
  for (const [key, generatedEntry] of generatedByKey) {
    const existingEntry = existingByKey.get(key);
    if (existingEntry === undefined) {
      continue;
    }
    if (JSON.stringify(existingEntry) !== JSON.stringify(generatedEntry)) {
      lines.push(`changed: ${DescribeEntry(generatedEntry)}`);
    }
  }
  return lines;
}

function Main(): void {
  const check = process.argv.includes("--check");
  const generatedDoc = BuildGenerated();
  const generated = Format(generatedDoc);
  if (check) {
    let existingRaw = "";
    try {
      existingRaw = readFileSync(x_Output, "utf8");
    }
    catch {
      throw new Error(
        `checked-in dispatch manifest missing at ${x_Output}; run without --check to generate`,
      );
    }
    if (existingRaw !== generated) {
      const existingDoc = JSON.parse(existingRaw) as GeneratedManifest;
      const drift = DescribeDivergence(existingDoc, generatedDoc);
      throw new Error(
        "dispatch_manifest.generated.json diverges from --describe-slots:\n"
        + (drift.length > 0 ? drift.join("\n") : "(byte-level drift without entry-key changes)")
        + "\nRe-run scripts/generate_dispatch_manifest.ts and commit the result.",
      );
    }
    process.stdout.write(`dispatch manifest is current: ${x_Output}\n`);
    return;
  }
  writeFileSync(x_Output, generated);
  process.stdout.write(`wrote ${x_Output}\n`);
}

Main();
