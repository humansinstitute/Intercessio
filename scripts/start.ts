#!/usr/bin/env bun

import { $ } from "bun";

const extraArgs = process.argv.slice(2);

console.log("🚀 Running setup before start...");
await $`bun run setup`;

console.log("▶️  Launching interactive CLI...");
const command = extraArgs.length > 0 ? ["bun", "run", "dev", "--", ...extraArgs] : ["bun", "run", "dev"];
const devProcess = Bun.spawn(command, {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await devProcess.exited;
if (exitCode !== 0) process.exitCode = exitCode;
