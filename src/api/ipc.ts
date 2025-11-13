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
};

export type StartNostrConnectRequest = {
  type: "start-nostr-connect";
  keyId: string;
  alias: string;
  relays: string[];
  uri: string;
  autoApprove: boolean;
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

export type RenameSessionRequest = {
  type: "rename-session";
  sessionId: string;
  alias: string;
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
  | RenameSessionRequest
  | PingRequest
  | ShutdownRequest;

export type IPCResponse =
  | { ok: true; bunkerUri?: string; sessionId?: string; sessions?: SessionInfo[] }
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
