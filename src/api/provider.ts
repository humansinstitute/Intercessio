import { RelayPool } from "applesauce-relay";
import { NostrConnectProvider, SimpleSigner } from "applesauce-signers";
import { EventTemplate } from "nostr-tools";

import { formatPubkey } from "./key-store.js";
import { PromptSession } from "./prompts.js";
import { log } from "./logger.js";

export type ProviderSettings = {
  relays: string[];
  autoApprove: boolean;
  secret?: string;
  prompter?: PromptSession;
  sessionLabel?: string;
};

export function shortText(text: string, size = 16) {
  return text.length <= size ? text : `${text.slice(0, size)}…`;
}

export function describeEvent(draft: EventTemplate) {
  const preview = draft.content?.length > 120 ? `${draft.content.slice(0, 120)}…` : draft.content || "";
  return `kind=${draft.kind ?? "?"} tags=${draft.tags?.length ?? 0} content="${preview}"`;
}

function requestHandlerFactory(opts: ProviderSettings) {
  const { autoApprove, prompter, sessionLabel } = opts;

  const ensurePrompt = async (question: string, defaultValue = false) => {
    if (autoApprove) return true;
    if (!prompter) throw new Error("Prompt requested but none available");
    return prompter.confirm(question, defaultValue);
  };

  return {
    onConnect: async (client: string, permissions: string[]) => {
      const summary = permissions.length ? permissions.join(", ") : "no permissions";
      return ensurePrompt(`Allow ${shortText(formatPubkey(client))} to connect (${summary})?`, true);
    },
    onSignEvent: async (draft: EventTemplate, client: string) => {
      const label = sessionLabel ? `${sessionLabel}: ` : "";
      log.info(`${label}Sign request`, `${formatPubkey(client)} ${describeEvent(draft)}`);
      return ensurePrompt(`Sign event for ${shortText(formatPubkey(client))}?`, false);
    },
    onNip04Encrypt: async (pubkey: string, plaintext: string, client: string) => {
      log.info("nip04 encrypt", `to ${shortText(formatPubkey(pubkey))} payload=${shortText(plaintext)}`);
      return ensurePrompt(`Allow nip04 encrypt for ${shortText(formatPubkey(client))}?`, true);
    },
    onNip04Decrypt: async (pubkey: string, _ciphertext: string, client: string) => {
      return ensurePrompt(`Allow nip04 decrypt from ${shortText(formatPubkey(pubkey))}?`, true);
    },
    onNip44Encrypt: async (pubkey: string, plaintext: string, client: string) => {
      log.info("nip44 encrypt", `to ${shortText(formatPubkey(pubkey))} payload=${shortText(plaintext)}`);
      return ensurePrompt(`Allow nip44 encrypt for ${shortText(formatPubkey(client))}?`, true);
    },
    onNip44Decrypt: async (pubkey: string, _ciphertext: string, client: string) => {
      return ensurePrompt(`Allow nip44 decrypt from ${shortText(formatPubkey(pubkey))}?`, true);
    },
  };
}

export function buildProvider(upstream: SimpleSigner, opts: ProviderSettings) {
  const pool = new RelayPool();
  const callbacks = requestHandlerFactory(opts);

  return new NostrConnectProvider({
    relays: opts.relays,
    upstream,
    signer: upstream,
    pool,
    secret: opts.secret,
    onClientConnect: (client) => log.success(`Client connected: ${formatPubkey(client)}`),
    onClientDisconnect: (client) => log.warn(`Client disconnected: ${formatPubkey(client)}`),
    ...callbacks,
  });
}
