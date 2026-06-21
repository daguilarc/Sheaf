#!/usr/bin/env node

import { runCli } from "./cli.js";

const result = await runCli(process.argv.slice(2), process.stdin, process.stdout, process.stderr, process.cwd());
process.exitCode = result.exitCode;
