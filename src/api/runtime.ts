import { NostrConnectProvider } from "applesauce-signers";
import { log } from "./logger.js";

export async function waitForShutdown(provider: NostrConnectProvider) {
  await new Promise<void>((resolve) => {
    const cleanup = async (signal: NodeJS.Signals) => {
      log.info(`Received ${signal}, shutting down...`);
      process.off("SIGINT", cleanup);
      process.off("SIGTERM", cleanup);
      await provider.stop();
      resolve();
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}
