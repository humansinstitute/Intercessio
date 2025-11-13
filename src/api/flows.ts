import chalk from "chalk";
import { randomBytes } from "node:crypto";

import { DEFAULT_RELAYS } from "./constants.js";
import { log } from "./logger.js";
import { getActiveKeyId } from "./key-store.js";
import { PromptSession, parseListInput } from "./prompts.js";
import { ensureServerRunning } from "./server-control.js";
import { sendIPCRequest } from "./ipc.js";

type RelayInput = string[] | undefined;

export type NostrConnectFlowOptions = {
  uri?: string;
  relays?: string[];
  autoApprove?: boolean;
  keyId?: string;
  alias?: string;
};

export type BunkerFlowOptions = {
  relays?: string[];
  autoApprove?: boolean;
  secret?: string;
  keyId?: string;
  alias?: string;
};

function normalizeRelays(relays: RelayInput): string[] {
  const list = relays?.length ? relays : DEFAULT_RELAYS;
  const normalized = list.map((relay) => {
    let value = relay.trim();
    if (!/^wss?:\/\//i.test(value)) value = `wss://${value}`;
    return value.replace(/\/+$/, "");
  });
  return Array.from(new Set(normalized));
}

function randomSecret() {
  return randomBytes(16).toString("hex");
}

async function resolveKeyId(provided?: string) {
  if (provided) return provided;
  const active = await getActiveKeyId();
  if (!active) throw new Error("No active key selected. Run `bun start` and choose a key first.");
  return active;
}

export async function runNostrConnectFlow(options: NostrConnectFlowOptions, prompter: PromptSession) {
  const uriAnswer = await prompter.input("Paste nostrconnect:// URI", options.uri ?? "");
  const uri = uriAnswer.trim();
  if (!uri) throw new Error("A nostrconnect:// URI is required.");

  const relayAnswer = await prompter.input(
    "Relay list (comma separated)",
    options.relays?.join(", ") ?? DEFAULT_RELAYS.join(", "),
  );
  const relays = normalizeRelays(parseListInput(relayAnswer, DEFAULT_RELAYS));
  const autoApprove =
    typeof options.autoApprove === "boolean"
      ? options.autoApprove
      : await prompter.confirm("Auto approve requests?", false);
  if (!autoApprove) throw new Error("Background server requires auto-approve to avoid blocking prompts.");

  const aliasDefault = options.alias ?? `Nostr Connect ${new Date().toLocaleString()}`;
  const alias = (await prompter.input("Alias for this connection", aliasDefault)).trim() || aliasDefault;

  const keyId = await resolveKeyId(options.keyId);
  await ensureServerRunning();
  const response = await sendIPCRequest({
    type: "start-nostr-connect",
    keyId,
    alias,
    relays,
    uri,
    autoApprove,
  });
  if (!response.ok) {
    const message = "error" in response ? response.error : "Failed to start nostr connect session.";
    throw new Error(message);
  }
  log.success("Server is handling the connection in the background.");
  log.info(`Session ID: ${response.sessionId}`);
  log.info("You can close this CLI and the server will continue signing.");
}

export async function runBunkerFlow(options: BunkerFlowOptions, prompter: PromptSession) {
  const relayAnswer = await prompter.input(
    "Relay list (comma separated)",
    options.relays?.join(", ") ?? DEFAULT_RELAYS.join(", "),
  );
  const relays = normalizeRelays(parseListInput(relayAnswer, DEFAULT_RELAYS));
  const autoApprove =
    typeof options.autoApprove === "boolean"
      ? options.autoApprove
      : await prompter.confirm("Auto approve requests?", false);

  const secretInput =
    typeof options.secret === "string"
      ? options.secret
      : await prompter.input("Shared secret (leave blank for random)", "");
  const secret = secretInput.trim() || randomSecret();

  const keyId = await resolveKeyId(options.keyId);
  const aliasDefault = options.alias ?? `Bunker ${new Date().toLocaleString()}`;
  const alias = (await prompter.input("Alias for this bunker session", aliasDefault)).trim() || aliasDefault;
  await ensureServerRunning();
  const response = await sendIPCRequest({
    type: "start-bunker",
    keyId,
    alias,
    relays,
    secret,
    autoApprove,
  });

  if (!response.ok || !response.bunkerUri) {
    const message = !response.ok && "error" in response ? response.error : "Failed to start bunker session.";
    throw new Error(message);
  }

  log.success("Server started bunker provider in the background.");
  console.log(chalk.bold(response.bunkerUri));
  log.info(`Session ID: ${response.sessionId}`);
  log.info(`Relays: ${relays.join(", ")}`);
  log.info(`Secret: ${secret}`);
  log.info("You can close this CLI and the server will continue signing.");
}
