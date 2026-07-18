import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const cloudflareHeaders = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Permissions-Policy: midi=(self)

/dist/wasm/*.wasm
  Content-Type: application/wasm
`;

export async function publishSite({
  browserRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  publishRoot = path.join(browserRoot, "dist", "site"),
} = {}) {
  const required = [
    "public/index.html",
    "public/synth-browser.css",
    "dist/src",
    "dist/wasm/app.js",
  ];
  for (const relativePath of required) {
    await assertExists(path.join(browserRoot, relativePath), relativePath);
  }

  await rm(publishRoot, { recursive: true, force: true });
  await mkdir(publishRoot, { recursive: true });
  await cp(path.join(browserRoot, "public"), publishRoot, { recursive: true });
  await cp(path.join(browserRoot, "dist", "src"), path.join(publishRoot, "dist", "src"), { recursive: true });
  await cp(path.join(browserRoot, "dist", "wasm"), path.join(publishRoot, "dist", "wasm"), { recursive: true });
  await writeFile(path.join(publishRoot, "_headers"), cloudflareHeaders);
  return { publishRoot };
}

async function assertExists(filename, relativePath) {
  try {
    await stat(filename);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing required browser publish artifact: ${relativePath}`);
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { publishRoot } = await publishSite();
  console.log(`Published browser site to ${path.relative(process.cwd(), publishRoot)}`);
}
