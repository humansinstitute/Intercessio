import { RelayPool } from "applesauce-relay";
import { NostrConnectProvider, SimpleSigner } from "applesauce-signers";
import type { EventTemplate } from "nostr-tools";

import { formatPubkey } from "./key-store.js";
import { PromptSession } from "./prompts.js";
import { log } from "./logger.js";
import { createPendingApproval } from "./pending-approvals.js";
import type { SigningTemplate } from "../signingTemplates/types.js";

export type ProviderActivity =
  | { type: "sign-request"; client: string; description: string; draft: EventTemplate }
  | { type: "sign-decision"; client: string; description: string; draft: EventTemplate; approved: boolean }
  | { type: "client-connected"; client: string }
  | { type: "client-disconnected"; client: string }
  | { type: "connect-request"; client: string; permissions: string[]; approved: boolean }
  | { type: "nip04"; mode: "encrypt" | "decrypt"; peer: string; client: string }
  | { type: "nip44"; mode: "encrypt" | "decrypt"; peer: string; client: string };

type SessionSummary = {
  id: string;
  alias?: string;
  type: "bunker" | "nostr-connect";
};

export type PolicyRef = { current: SigningTemplate };

export type ProviderSettings = {
  relays: string[];
  autoApprove: boolean;
  secret?: string;
  prompter?: PromptSession;
  sessionLabel?: string;
  onActivity?: (event: ProviderActivity) => void;
  policyRef: PolicyRef;
  session: SessionSummary;
};

export function shortText(text: string, size = 16) {
  return text.length <= size ? text : `${text.slice(0, size)}…`;
}

export function describeEvent(draft: EventTemplate) {
  const preview = draft.content?.length > 120 ? `${draft.content.slice(0, 120)}…` : draft.content || "";
  return `kind=${draft.kind ?? "?"} tags=${draft.tags?.length ?? 0} content="${preview}"`;
}

function requestHandlerFactory(opts: ProviderSettings) {
  const { autoApprove, prompter, sessionLabel, policyRef, session } = opts;
  const emit = opts.onActivity;

  const ensurePrompt = async (question: string, defaultValue = false, forcePrompt = false) => {
    if (autoApprove && !forcePrompt) return true;
    if (!prompter) throw new Error("Prompt requested but none available");
    return prompter.confirm(question, defaultValue);
  };

  return {
    onConnect: async (client: string, permissions: string[]) => {
      const summary = permissions.length ? permissions.join(", ") : "no permissions";
      const approved = await ensurePrompt(`Allow ${shortText(formatPubkey(client))} to connect (${summary})?`, true);
      emit?.({ type: "connect-request", client, permissions, approved });
      return approved;
    },
    onSignEvent: async (draft: EventTemplate, client: string) => {
      const label = sessionLabel ? `${sessionLabel}: ` : "";
      const description = `${formatPubkey(client)} ${describeEvent(draft)}`;
      log.info(`${label}Sign request`, description);
      emit?.({ type: "sign-request", client, description, draft });

      const policy = policyRef.current;
      const decision = policy.evaluate({
        event: draft,
        client,
        session,
      });

      let approved = false;
      if (decision === "SIGN") {
        approved = await ensurePrompt(`Sign event for ${shortText(formatPubkey(client))}?`, false);
      } else if (decision === "REFER") {
        if (prompter) {
          approved = await ensurePrompt(
            `Policy ${policy.label} requires manual approval for ${shortText(formatPubkey(client))}. Approve?`,
            false,
            true,
          );
        } else {
          log.info(
            `${label}Policy ${policy.id} requires approval for ${shortText(formatPubkey(client))}; awaiting decision.`,
          );
          const { decision } = createPendingApproval({
            sessionId: session.id,
            sessionLabel: session.alias,
            client,
            description,
            draft,
            policy: { id: policy.id, label: policy.label },
          });
          approved = await decision;
        }
      } else {
        log.warn(`${label}Policy ${policy.id} rejected request from ${shortText(formatPubkey(client))}`);
      }

      emit?.({
        type: "sign-decision",
        client,
        description,
        draft,
        approved,
      });
      return approved;
    },
    onNip04Encrypt: async (pubkey: string, plaintext: string, client: string) => {
      log.info("nip04 encrypt", `to ${shortText(formatPubkey(pubkey))} payload=${shortText(plaintext)}`);
      const approved = await ensurePrompt(`Allow nip04 encrypt for ${shortText(formatPubkey(client))}?`, true);
      emit?.({ type: "nip04", mode: "encrypt", peer: formatPubkey(pubkey), client });
      return approved;
    },
    onNip04Decrypt: async (pubkey: string, _ciphertext: string, client: string) => {
      const approved = await ensurePrompt(`Allow nip04 decrypt from ${shortText(formatPubkey(pubkey))}?`, true);
      emit?.({ type: "nip04", mode: "decrypt", peer: formatPubkey(pubkey), client });
      return approved;
    },
    onNip44Encrypt: async (pubkey: string, plaintext: string, client: string) => {
      log.info("nip44 encrypt", `to ${shortText(formatPubkey(pubkey))} payload=${shortText(plaintext)}`);
      const approved = await ensurePrompt(`Allow nip44 encrypt for ${shortText(formatPubkey(client))}?`, true);
      emit?.({ type: "nip44", mode: "encrypt", peer: formatPubkey(pubkey), client });
      return approved;
    },
    onNip44Decrypt: async (pubkey: string, _ciphertext: string, client: string) => {
      const approved = await ensurePrompt(`Allow nip44 decrypt from ${shortText(formatPubkey(pubkey))}?`, true);
      emit?.({ type: "nip44", mode: "decrypt", peer: formatPubkey(pubkey), client });
      return approved;
    },
  };
}

class ManagedNostrConnectProvider extends NostrConnectProvider {
  async resumeClient(client: string, secret?: string) {
    const target = await this.signer.getPublicKey();
    await this.handleConnect(client, [target, secret ?? "", ""]);
  }
}

export type ManagedProvider = ManagedNostrConnectProvider;

export function buildProvider(upstream: SimpleSigner, opts: ProviderSettings) {
  const pool = new RelayPool();
  const callbacks = requestHandlerFactory(opts);

  return new ManagedNostrConnectProvider({
    relays: opts.relays,
    upstream,
    signer: upstream,
    pool,
    secret: opts.secret,
    onClientConnect: (client) => {
      log.success(`Client connected: ${formatPubkey(client)}`);
      opts.onActivity?.({ type: "client-connected", client });
    },
    onClientDisconnect: (client) => {
      log.warn(`Client disconnected: ${formatPubkey(client)}`);
      opts.onActivity?.({ type: "client-disconnected", client });
    },
    ...callbacks,
  });
}
