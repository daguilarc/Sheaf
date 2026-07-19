import process from "node:process";
import { fileURLToPath } from "node:url";

import { assemblePackage } from "./package-contract.mjs";

const OPTIONS = Object.freeze({
  "--app-id": "appId",
  "--source-dir": "sourceDirectory",
  "--output-dir": "outputDirectory",
  "--entry": "entry",
  "--wasm": "wasm",
  "--pthread-worker": "pthreadWorker",
  "--wasm-worker": "wasmWorker",
  "--audio-worklet": "audioWorklet",
});

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const field = OPTIONS[option];
    const value = arguments_[index + 1];
    if (!field) throw new Error(`unknown package-app option ${String(option)}`);
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--"))
      throw new Error(`${option} requires a value`);
    if (Object.hasOwn(values, field)) throw new Error(`${option} was provided more than once`);
    values[field] = value;
  }
  for (const [option, field] of Object.entries(OPTIONS)) {
    if (!Object.hasOwn(values, field)) throw new Error(`${option} is required`);
  }
  return values;
}

export async function packageApp(arguments_) {
  const values = parseArguments(arguments_);
  return assemblePackage({
    appId: values.appId,
    sourceDirectory: values.sourceDirectory,
    outputDirectory: values.outputDirectory,
    artifacts: {
      entry: values.entry,
      wasm: values.wasm,
      pthreadWorker: values.pthreadWorker,
      wasmWorker: values.wasmWorker,
      audioWorklet: values.audioWorklet,
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageApp(process.argv.slice(2))
    .then((record) => process.stdout.write(`${JSON.stringify(record)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
