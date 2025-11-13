#!/usr/bin/env bun

import net from "node:net";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import {
  getSocketPath,
  IPCRequest,
  IPCResponse,
  SessionInfo,
  StartBunkerRequest,
  StartNostrConnectRequest,
} from "./api/ipc.js";
import { getKeyRecordById } from "./api/key-store.js";
import { buildProvider } from "./api/provider.js";
import { log } from "./api/logger.js";
import { SimpleSigner } from "applesauce-signers";
import {
  SessionRecord,
  deactivateSession,
  getSessionById,
  getDB,
  listSessions,
  updateSessionAlias,
  updateSessionStatus,
  upsertSession,
} from "./api/db.js";

type RuntimeSession = {
  record: SessionRecord;
  provider: ReturnType<typeof buildProvider>;
};

const runtimes = new Map<string, RuntimeSession>();
let serverRef: net.Server | null = null;

function toSessionInfo(record: SessionRecord): SessionInfo {
  return {
    id: record.id,
    type: record.type,
    keyId: record.keyId,
    relays: record.relays,
    status: record.status,
    alias: record.alias,
    lastClient: record.lastClient,
    autoApprove: record.autoApprove,
    active: record.active,
    uri: record.uri,
  };
}

async function registerSessionRuntime(record: SessionRecord) {
  const key = await getKeyRecordById(record.keyId);
  if (!key) throw new Error(`Key ${record.keyId} not found`);

  const signer = SimpleSigner.fromKey(key.secret);
  const provider = buildProvider(signer, {
    relays: record.relays,
    autoApprove: record.autoApprove,
    secret: record.type === "bunker" ? record.secret : undefined,
    sessionLabel: record.alias || record.id,
  });

  if (record.type === "bunker") {
    await provider.start();
    const bunkerUri = await provider.getBunkerURI();
    if (!record.uri || record.uri !== bunkerUri) {
      record.uri = bunkerUri;
      record.updatedAt = Date.now();
      await upsertSession(record);
    }
    provider
      .waitForClient()
      .then((client) => {
        record.status = "connected";
        record.lastClient = client;
        record.updatedAt = Date.now();
        record.active = true;
        updateSessionStatus(record.id, "connected", client).catch((err) =>
          log.error(`Failed to update session status: ${err instanceof Error ? err.message : String(err)}`),
        );
        const runtime = runtimes.get(record.id);
        if (runtime) runtime.record = record;
        log.success(`Bunker client connected for session ${record.alias || record.id}: ${client}`);
      })
      .catch((error) => {
        log.error(`Error waiting for bunker client: ${error instanceof Error ? error.message : String(error)}`);
      });
  } else {
    if (!record.uri) throw new Error("Missing nostrconnect URI for session");
    await provider.start(record.uri);
    record.status = "connected";
    record.updatedAt = Date.now();
    await upsertSession(record);
  }

  runtimes.set(record.id, { record, provider });
}

async function createSessionRecord(
  partial: Omit<SessionRecord, "status" | "active" | "createdAt" | "updatedAt" | "lastClient">,
) {
  const now = Date.now();
  const record: SessionRecord = {
    ...partial,
    status: partial.type === "bunker" ? "waiting" : "connected",
    active: true,
    lastClient: undefined,
    createdAt: now,
    updatedAt: now,
  };
  await upsertSession(record);
  return record;
}

async function startBunkerSession(req: StartBunkerRequest): Promise<IPCResponse> {
  const sessionId = randomUUID();
  const record = await createSessionRecord({
    id: sessionId,
    type: "bunker",
    keyId: req.keyId,
    alias: (req.alias ?? `Bunker ${sessionId}`).trim(),
    relays: req.relays,
    secret: req.secret,
    uri: undefined,
    autoApprove: req.autoApprove,
  });

  await registerSessionRuntime(record);
  return { ok: true, bunkerUri: record.uri, sessionId };
}

async function startNostrConnectSession(req: StartNostrConnectRequest): Promise<IPCResponse> {
  const sessionId = randomUUID();
  const record = await createSessionRecord({
    id: sessionId,
    type: "nostr-connect",
    keyId: req.keyId,
    alias: (req.alias ?? `NostrConnect ${sessionId}`).trim(),
    relays: req.relays,
    secret: undefined,
    uri: req.uri,
    autoApprove: req.autoApprove,
  });

  await registerSessionRuntime(record);
  return { ok: true, sessionId };
}

async function stopSession(sessionId: string, remove = false): Promise<IPCResponse> {
  const runtime = runtimes.get(sessionId);
  if (runtime) {
    await runtime.provider.stop();
    runtimes.delete(sessionId);
  }

  await deactivateSession(sessionId);

  if (remove) {
    const db = await getDB();
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  return { ok: true };
}

async function renameSession(sessionId: string, alias: string): Promise<IPCResponse> {
  const record = await getSessionById(sessionId);
  if (!record) return { ok: false, error: "Session not found" };
  await updateSessionAlias(sessionId, alias);
  const runtime = runtimes.get(sessionId);
  if (runtime) runtime.record.alias = alias;
  return { ok: true };
}

async function restoreSessionsOnBoot() {
  const records = await listSessions(true);
  for (const record of records) {
    try {
      await registerSessionRuntime(record);
      log.info(`Restored session ${record.alias || record.id} (${record.type})`);
    } catch (error) {
      log.error(
        `Failed to restore session ${record.alias || record.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function cleanupSocket() {
  const socketPath = getSocketPath();
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
}

async function ensureNoRunningInstance(socketPath: string) {
  return new Promise<void>((resolve) => {
    const client = net.createConnection(socketPath);
    client.on("connect", () => {
      log.warn("Signing server already running.");
      process.exit(0);
    });
    client.on("error", (err: any) => {
      if (err && err.code === "ECONNREFUSED") {
        cleanupSocket();
      }
      resolve();
    });
  });
}

async function stopAllSessions() {
  const tasks: Promise<void>[] = [];
  for (const [id, runtime] of runtimes.entries()) {
    tasks.push(
      runtime.provider
        .stop()
        .catch((err) => log.error(`Failed to stop session ${id}: ${err instanceof Error ? err.message : String(err)}`)),
    );
    runtimes.delete(id);
  }
  await Promise.all(tasks);
}

async function shutdownServer(exitCode = 0) {
  await stopAllSessions();
  if (serverRef) {
    await new Promise<void>((resolve) => serverRef!.close(() => resolve()));
    serverRef = null;
  }
  cleanupSocket();
  process.exit(exitCode);
}

async function handleRequest(req: IPCRequest): Promise<IPCResponse> {
  switch (req.type) {
    case "ping":
      return { ok: true };
    case "list-sessions": {
      const records = await listSessions(false);
      return { ok: true, sessions: records.map(toSessionInfo) };
    }
    case "stop-session":
      return stopSession(req.sessionId);
    case "delete-session":
      return stopSession(req.sessionId, true);
    case "rename-session":
      return renameSession(req.sessionId, req.alias);
    case "start-bunker":
      return startBunkerSession(req);
    case "start-nostr-connect":
      return startNostrConnectSession(req);
    case "shutdown":
      setTimeout(() => {
        shutdownServer(0).catch((err) => log.error(err instanceof Error ? err.message : String(err)));
      }, 10);
      return { ok: true };
    default:
      return { ok: false, error: "Unknown request" };
  }
}

async function startServer() {
  const socketPath = getSocketPath();
  await ensureNoRunningInstance(socketPath);
  cleanupSocket();
  await restoreSessionsOnBoot();

  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk.toString();
      if (buffer.endsWith("\n")) {
        try {
          const req = JSON.parse(buffer.trim()) as IPCRequest;
          const res = await handleRequest(req);
          socket.write(JSON.stringify(res) + "\n");
        } catch (error) {
          socket.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + "\n");
        } finally {
          buffer = "";
        }
      }
    });
  });

  serverRef = server;
  server.listen(socketPath, () => {
    log.info(`Server listening on ${socketPath}`);
  });

  process.on("SIGINT", () => shutdownServer(0));
  process.on("SIGTERM", () => shutdownServer(0));
  process.on("exit", cleanupSocket);
}

startServer().catch((error) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
