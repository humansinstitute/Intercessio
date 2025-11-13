import { sendIPCRequest } from "./ipc.js";

let verified = false;

export async function ensureServerRunning() {
  if (verified) return;
  try {
    await sendIPCRequest({ type: "ping" });
    verified = true;
  } catch {
    throw new Error("Signing server is not running. Start it in another terminal with `intercessio server`.");
  }
}
