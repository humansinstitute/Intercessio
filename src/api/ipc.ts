import net from "node:net";
import path from "node:path";
import os from "node:os";

import { CONFIG_DIR } from "./constants.js";

export type StartBunkerRequest = {
  type: "start-bunker";
  keyId: string;
  alias: string;
  relays: string[];
  secret?: string;
  autoApprove: boolean;
  template?: string;
};

export type StartNostrConnectRequest = {
  type: "start-nostr-connect";
  keyId: string;
  alias: string;
  relays: string[];
  uri: string;
  autoApprove: boolean;
  template?: string;
};

export type StopSessionRequest = {
  type: "stop-session";
  sessionId: string;
};

export type DeleteSessionRequest = {
  type: "delete-session";
  sessionId: string;
};

export type ListSessionsRequest = {
  type: "list-sessions";
};

export type ListActivityRequest = {
  type: "list-activity";
};

export type RenameSessionRequest = {
  type: "rename-session";
  sessionId: string;
  alias: string;
};

export type ListApprovalsRequest = {
  type: "list-approvals";
};

export type ResolveApprovalRequest = {
  type: "resolve-approval";
  id: string;
  decision: "approve" | "reject";
};

export type UpdateSessionTemplateRequest = {
  type: "update-session-template";
  sessionId: string;
  template: string;
};

export type PingRequest = {
  type: "ping";
};

export type ShutdownRequest = {
  type: "shutdown";
};

export type IPCRequest =
  | StartBunkerRequest
  | StartNostrConnectRequest
  | StopSessionRequest
  | DeleteSessionRequest
  | ListSessionsRequest
  | ListActivityRequest
  | ListApprovalsRequest
  | ResolveApprovalRequest
  | RenameSessionRequest
  | UpdateSessionTemplateRequest
  | PingRequest
  | ShutdownRequest;

export type IPCResponse =
  | {
      ok: true;
      bunkerUri?: string;
      sessionId?: string;
      sessions?: SessionInfo[];
      activity?: ActivityEntrySummary[];
      approvals?: ApprovalSummary[];
    }
  | { ok: false; error: string };

export type SessionInfo = {
  id: string;
  type: "bunker" | "nostr-connect";
  keyId: string;
  relays: string[];
  status: "waiting" | "connected";
  alias: string;
  lastClient?: string;
  autoApprove: boolean;
  active: boolean;
  uri?: string;
  template: string;
};

export type ActivityEntrySummary = {
  id: string;
  type: string;
  summary: string;
  sessionId?: string;
  sessionLabel?: string;
  client?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
};

export type ApprovalSummary = {
  id: string;
  sessionId: string;
  sessionAlias?: string;
  sessionType: "bunker" | "nostr-connect";
  client: string;
  eventKind?: number;
  eventSummary?: string;
  policyId: string;
  policyLabel: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
};

export function getSocketPath() {
  return path.join(CONFIG_DIR, "intercessio.sock");
}

export function sendIPCRequest<T extends IPCRequest>(req: T): Promise<IPCResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    const client = net.createConnection(socketPath);

    client.on("error", (err) => {
      reject(err);
    });

    client.on("connect", () => {
      client.write(JSON.stringify(req) + "\n");
    });

    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString();
      if (data.endsWith("\n")) {
        try {
          const parsed = JSON.parse(data.trim());
          resolve(parsed);
        } catch (error) {
          reject(error);
        } finally {
          client.end();
        }
      }
    });
  });
}
