#!/usr/bin/env bun

import { Command } from "commander";

import { createPromptSession, PromptSession } from "./api/prompts.js";
import {
  createKeyInteractive,
  importKeyInteractive,
  listKeys,
  showStoredKeyStatus,
  getActiveKeyId,
  setActiveKeyId,
  KeyMetadata,
} from "./api/key-store.js";
import { runBunkerFlow, runNostrConnectFlow } from "./api/flows.js";
import { DEFAULT_RELAYS } from "./api/constants.js";
import { log } from "./api/logger.js";
import { sendIPCRequest, SessionInfo } from "./api/ipc.js";
import { ensureServerRunning } from "./api/server-control.js";

const program = new Command();
program.name("intercessio").description("Intercessio: a minimal Nostr signer CLI powered by applesauce").version("0.2.0");

async function ensureKeySelected(prompter: PromptSession): Promise<KeyMetadata> {
  while (true) {
    const keys = await listKeys();
    if (keys.length === 0) {
      console.log("\nNo keys found. Choose an option:");
      console.log("  1) Generate a new key");
      console.log("  2) Import an existing nsec/hex key");
      const choice = (await prompter.input("Select option", "1")).trim();
      if (choice === "2") await importKeyInteractive(prompter);
      else await createKeyInteractive(prompter);
      continue;
    }

    const activeId = await getActiveKeyId();
    console.log("\n🔑 Keys");
    keys.forEach((key, index) => {
      const activeMarker = key.id === activeId ? "*" : " ";
      console.log(`  ${index + 1})${activeMarker} ${key.label} (${key.npub.slice(0, 12)}…)`);
    });
    const generateOption = keys.length + 1;
    const importOption = keys.length + 2;
    console.log(`  ${generateOption}) Generate a new key`);
    console.log(`  ${importOption}) Import an existing nsec/hex key`);

    const choice = Number(await prompter.input("Select option", "1"));
    if (Number.isInteger(choice) && choice >= 1 && choice <= keys.length) {
      const selected = keys[choice - 1];
      await setActiveKeyId(selected.id);
      log.info(`Using key ${selected.label}`);
      return selected;
    } else if (choice === generateOption) {
      await createKeyInteractive(prompter);
    } else if (choice === importOption) {
      await importKeyInteractive(prompter);
    } else {
      console.log("Please choose a valid option.");
    }
  }
}

async function fetchSessions(): Promise<SessionInfo[]> {
  await ensureServerRunning();
  const response = await sendIPCRequest({ type: "list-sessions" });
  if (!response.ok || !response.sessions) throw new Error("Failed to fetch sessions from server.");
  return response.sessions;
}

async function printSessionsList() {
  const sessions = await fetchSessions();
  if (sessions.length === 0) {
    console.log("No sessions have been created yet.");
    return;
  }
  for (const session of sessions) {
    const status = session.active ? session.status : "stopped";
    const label = session.alias || session.id;
    console.log(
      `${session.id} | [${session.type}] ${label} | key=${session.keyId} | relays=${session.relays.join(", ")} | status=${status} | policy=${session.template}`,
    );
    if (session.uri) console.log(`  uri: ${session.uri}`);
    if (session.lastClient) console.log(`  last client: ${session.lastClient}`);
  }
}

async function printBunkerCodes() {
  const sessions = await fetchSessions();
  const bunkers = sessions.filter((session) => session.type === "bunker");
  if (bunkers.length === 0) {
    console.log("No bunker sessions found. Start one with `intercessio bunker` or the interactive menu.");
    return;
  }
  for (const session of bunkers) {
    const label = session.alias || session.id;
    const status = session.active ? session.status : "stopped";
    console.log(`${label} (${session.id})`);
    console.log(`  status: ${status}`);
    console.log(`  relays: ${session.relays.join(", ")}`);
    console.log(`  policy: ${session.template}`);
    if (session.uri) console.log(`  uri: ${session.uri}`);
    else console.log("  uri: (pending; waiting for provider)");
    if (session.lastClient) console.log(`  last client: ${session.lastClient}`);
  }
}

async function manageConnections(prompter: PromptSession) {
  console.log("\n🔗 Manage Connections");
  console.log("  1) Generate bunker code");
  console.log("  2) View bunker codes");
  console.log("  3) List sessions");
  console.log("  4) Stop a session");
  console.log("  5) Delete a session");
  console.log("  6) Back");
  const choice = (await prompter.input("Choose an option", "1")).trim();
  switch (choice) {
    case "1": {
      const key = await ensureKeySelected(prompter);
      await runBunkerFlow({ autoApprove: true, keyId: key.id, alias: `Bunker for ${key.label}` }, prompter);
      break;
    }
    case "2":
      await printBunkerCodes();
      break;
    case "3":
      await printSessionsList();
      break;
    case "4": {
      const sessionId = (await prompter.input("Enter session ID to stop", "")).trim();
      if (!sessionId) {
        console.log("Session ID is required.");
        return;
      }
      await ensureServerRunning();
      const response = await sendIPCRequest({ type: "stop-session", sessionId });
      if (!response.ok) throw new Error(response.error);
      log.success(`Stopped session ${sessionId}`);
      break;
    }
    case "5": {
      const sessionId = (await prompter.input("Enter session ID to delete", "")).trim();
      if (!sessionId) {
        console.log("Session ID is required.");
        return;
      }
      await ensureServerRunning();
      const response = await sendIPCRequest({ type: "delete-session", sessionId });
      if (!response.ok) throw new Error(response.error);
      log.success(`Deleted session ${sessionId}`);
      break;
    }
    default:
      console.log("Returning to main menu.");
  }
}

async function runInteractiveShell() {
  const prompter = createPromptSession();
  try {
    console.log("\n📋 Main Menu");
    console.log("  1) Log in via Nostr Connect");
    console.log("  2) Manage connections");
    console.log("  3) Manage keys");
    console.log("  4) Exit");

    let action = (await prompter.input("Choose an option", "1")).trim();
    while (!["1", "2", "3", "4"].includes(action)) {
      action = (await prompter.input("Please enter 1-4", "1")).trim();
    }

    switch (action) {
      case "1": {
        const key = await ensureKeySelected(prompter);
        await runNostrConnectFlow({ autoApprove: true, keyId: key.id, alias: `NostrConnect for ${key.label}` }, prompter);
        break;
      }
      case "2":
        await manageConnections(prompter);
        break;
      case "3":
        await ensureKeySelected(prompter);
        break;
      default:
        console.log("Goodbye!");
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    prompter.close();
  }
}

function interactiveAction<T extends Record<string, any>>(
  handler: (options: T, prompter: PromptSession) => Promise<void>,
) {
  return async (...args: any[]) => {
    const opts = args.pop();
    const prompter = createPromptSession();
    try {
      await handler(opts, prompter);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    } finally {
      prompter.close();
    }
  };
}

function safeAction<T extends any[]>(handler: (...args: T) => Promise<void>) {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
}

program
  .command("keygen")
  .description("Create or import a signer key (stores secrets in macOS Keychain)")
  .option("-i, --import", "Import an existing nsec/hex key", false)
  .action(
    interactiveAction(async ({ import: importFlag }: { import?: boolean }, prompter) => {
      if (importFlag) await importKeyInteractive(prompter);
      else await createKeyInteractive(prompter);
    }),
  );

program
  .command("nostr-connect")
  .description("Interactively respond to a nostrconnect:// URI")
  .option("-u, --uri <uri>", "nostrconnect:// URI to prefill")
  .option("-r, --relay <relays...>", "Relays to prefill", DEFAULT_RELAYS)
  .option("--auto-approve", "Automatically approve incoming requests", false)
  .option("--policy <policyId>", "Signing policy id to preselect")
  .action(
    interactiveAction(
      async (
        options: { uri?: string; relay?: string[]; autoApprove?: boolean; policy?: string },
        prompter,
      ) => {
        await runNostrConnectFlow(
          { uri: options.uri, relays: options.relay, autoApprove: options.autoApprove, template: options.policy },
          prompter,
        );
      },
    ),
  );

program
  .command("bunker")
  .description("Start a bunker provider and display the bunker:// URI")
  .option("-r, --relay <relays...>", "Relays to prefill", DEFAULT_RELAYS)
  .option("--secret <secret>", "Secret to reuse instead of generating")
  .option("--auto-approve", "Automatically approve incoming requests", false)
  .option("--policy <policyId>", "Signing policy id to preselect")
  .action(
    interactiveAction(
      async (
        options: { relay?: string[]; secret?: string; autoApprove?: boolean; policy?: string },
        prompter,
      ) => {
        await runBunkerFlow(
          {
            relays: options.relay,
            secret: options.secret,
            autoApprove: options.autoApprove,
            template: options.policy,
          },
          prompter,
        );
      },
    ),
  );

program
  .command("status")
  .description("Show stored key information")
  .action(
    safeAction(async () => {
      await showStoredKeyStatus();
    }),
  );

program
  .command("relays")
  .description("List default relays")
  .action(() => {
    console.log(DEFAULT_RELAYS.join("\n"));
  });

program
  .command("bunker-codes")
  .description("Display bunker URIs the server is currently advertising")
  .action(
    safeAction(async () => {
      await printBunkerCodes();
    }),
  );

program
  .command("server")
  .description("Start the long-running signing server")
  .action(async () => {
    await import("./server.js");
  });

const sessionsCommand = program.command("sessions").description("Manage long-running bunker/nostrconnect sessions");

sessionsCommand
  .command("list")
  .description("List all sessions known to the server")
  .action(
    safeAction(async () => {
      await printSessionsList();
    }),
  );

sessionsCommand
  .command("stop <sessionId>")
  .description("Stop a running session but keep it in history")
  .action(
    safeAction(async (sessionId: string) => {
      await ensureServerRunning();
      const response = await sendIPCRequest({ type: "stop-session", sessionId });
      if (!response.ok) throw new Error(response.error);
      log.success(`Stopped session ${sessionId}`);
    }),
  );

sessionsCommand
  .command("delete <sessionId>")
  .description("Stop and delete a session permanently")
  .action(
    safeAction(async (sessionId: string) => {
      await ensureServerRunning();
      const response = await sendIPCRequest({ type: "delete-session", sessionId });
      if (!response.ok) throw new Error(response.error);
      log.success(`Deleted session ${sessionId}`);
    }),
  );

sessionsCommand
  .command("rename <sessionId> <alias>")
  .description("Update the alias for a session")
  .action(
    safeAction(async (sessionId: string, alias: string) => {
      await ensureServerRunning();
      const response = await sendIPCRequest({ type: "rename-session", sessionId, alias });
      if (!response.ok) throw new Error(response.error);
      log.success(`Renamed session ${sessionId} to "${alias}"`);
    }),
  );

const extraArgs = process.argv.slice(2);
if (extraArgs.length === 0) {
  await runInteractiveShell();
} else {
  await program.parseAsync(process.argv);
}
