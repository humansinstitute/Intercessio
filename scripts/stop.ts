#!/usr/bin/env bun

import { sendIPCRequest } from "../src/api/ipc.js";

try {
  const response = await sendIPCRequest({ type: "shutdown" });
  if (response.ok) {
    console.log("Shutdown signal sent to signing server.");
  } else {
    console.error("Server responded with error:", response.error);
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Failed to send shutdown signal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
