#!/usr/bin/env bun

import { spawn } from "bun";

const server = spawn(["bun", "run", "./src/server.ts"], { stdout: "inherit", stderr: "inherit" });
const webui = spawn(["bun", "run", "./src/web/server.ts"], { stdout: "inherit", stderr: "inherit" });

const shutdown = () => {
  server.kill();
  webui.kill();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.exited.then(() => {
  console.log("Signing server exited.");
});

webui.exited.then(() => {
  console.log("Web UI exited.");
});
