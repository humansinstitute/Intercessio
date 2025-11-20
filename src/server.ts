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
import { buildProvider, ProviderActivity, PolicyRef } from "./api/provider.js";
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
import { recordActivity, ActivityType, listActivity } from "./api/activity-log.js";
import { getTemplateById, DEFAULT_TEMPLATE_ID } from "./api/signing-templates.js";
import {
  listPendingApprovals,
  resolvePendingApproval,
  rejectApprovalsForSession,
} from "./api/pending-approvals.js";

type RuntimeSession = {
  record: SessionRecord;
  provider: ReturnType<typeof buildProvider>;
  policyRef: PolicyRef;
};

const runtimes = new Map<string, RuntimeSession>();
let serverRef: net.Server | null = null;

async function markBunkerClientConnected(record: SessionRecord, client: string, resumed = false) {
  record.status = "connected";
  record.lastClient = client;
  record.updatedAt = Date.now();
  record.active = true;
  try {
    await updateSessionStatus(record.id, "connected", client);
  } catch (err) {
    log.error(`Failed to update session status: ${err instanceof Error ? err.message : String(err)}`);
  }
  const runtime = runtimes.get(record.id);
  if (runtime) runtime.record = record;
  const label = record.alias || record.id;
  const prefix = resumed ? "Resumed bunker client" : "Bunker client connected";
  log.success(`${prefix} for session ${label}: ${client}`);
}

function waitForBunkerClient(record: SessionRecord, provider: RuntimeSession["provider"]) {
  provider
    .waitForClient()
    .then((client) => markBunkerClientConnected(record, client))
    .catch((error) => {
      log.error(`Error waiting for bunker client: ${error instanceof Error ? error.message : String(error)}`);
    });
}

async function resumeBunkerSession(record: SessionRecord, provider: RuntimeSession["provider"]) {
  if (!record.lastClient || !record.secret) return false;
  try {
    await provider.resumeClient(record.lastClient, record.secret);
    await markBunkerClientConnected(record, record.lastClient, true);
    return true;
  } catch (error) {
    log.warn(
      `Unable to resume bunker session ${record.alias || record.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function logSessionEvent(record: SessionRecord, type: ActivityType, summary: string, metadata?: Record<string, unknown>) {
  recordActivity({
    type,
    summary,
    sessionId: record.id,
    sessionLabel: record.alias || record.id,
    metadata,
  });
}

function handleProviderActivity(record: SessionRecord, activity: ProviderActivity) {
  const sessionLabel = record.alias || record.id;
  switch (activity.type) {
    case "sign-request":
      recordActivity({
        type: "sign-request",
        summary: activity.description,
        sessionId: record.id,
        sessionLabel,
        client: activity.client,
        metadata: { stage: "requested", draft: activity.draft },
      });
      break;
    case "sign-decision":
      recordActivity({
        type: "sign-result",
        summary: `${activity.approved ? "Approved" : "Rejected"} ${activity.description}`,
        sessionId: record.id,
        sessionLabel,
        client: activity.client,
        metadata: { approved: activity.approved, draft: activity.draft },
      });
      break;
    case "client-connected":
      recordActivity({
        type: "provider-connect",
        summary: `Client connected: ${activity.client}`,
        sessionId: record.id,
        sessionLabel,
        client: activity.client,
      });
      break;
    case "client-disconnected":
      recordActivity({
        type: "provider-disconnect",
        summary: `Client disconnected: ${activity.client}`,
        sessionId: record.id,
        sessionLabel,
        client: activity.client,
      });
      break;
    case "connect-request":
      recordActivity({
        type: "provider-connect",
        summary: `Connect request from ${activity.client} (${activity.approved ? "approved" : "denied"})`,
        sessionId: record.id,
        sessionLabel,
        client: activity.client,
        metadata: { permissions: activity.permissions, approved: activity.approved },
      });
      break;
    case "nip04":
      recordActivity({
        type: "nip04",
        summary: `nip04 ${activity.mode} with ${activity.peer}`,
        sessionId: record.id,
        sessionLabel,
        client: activity.client,
      });
      break;
    case "nip44":
      recordActivity({
        type: "nip44",
        summary: `nip44 ${activity.mode} with ${activity.peer}`,
        sessionId: record.id,
        sessionLabel,
        client: activity.client,
      });
      break;
  }
}

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
    template: record.template,
  };
}

async function registerSessionRuntime(record: SessionRecord) {
  const key = await getKeyRecordById(record.keyId);
  if (!key) throw new Error(`Key ${record.keyId} not found`);

  const signer = SimpleSigner.fromKey(key.secret);
  const template = getTemplateById(record.template);
  const policyRef: PolicyRef = { current: template };
  const provider = buildProvider(signer, {
    relays: record.relays,
    autoApprove: record.autoApprove,
    secret: record.type === "bunker" ? record.secret : undefined,
    sessionLabel: record.alias || record.id,
    onActivity: (activity) => handleProviderActivity(record, activity),
    policyRef,
    session: { id: record.id, alias: record.alias, type: record.type },
  });

  if (record.type === "bunker") {
    await provider.start();
    const bunkerUri = await provider.getBunkerURI();
    if (!record.uri || record.uri !== bunkerUri) {
      record.uri = bunkerUri;
      record.updatedAt = Date.now();
      await upsertSession(record);
    }
    const resumed = await resumeBunkerSession(record, provider);
    if (!resumed) {
      waitForBunkerClient(record, provider);
    }
  } else {
    if (!record.uri) throw new Error("Missing nostrconnect URI for session");
    await provider.start(record.uri);
    record.status = "connected";
    record.updatedAt = Date.now();
    await upsertSession(record);
  }

  runtimes.set(record.id, { record, provider, policyRef });
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
    template: partial.template || DEFAULT_TEMPLATE_ID,
  };
  await upsertSession(record);
  logSessionEvent(
    record,
    "session-start",
    `${record.type === "bunker" ? "Bunker" : "NostrConnect"} session ${record.alias || record.id} created`,
    { relays: record.relays },
  );
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
    template: getTemplateById(req.template).id,
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
    template: getTemplateById(req.template).id,
  });

  await registerSessionRuntime(record);
  return { ok: true, sessionId };
}

async function stopSession(sessionId: string, remove = false): Promise<IPCResponse> {
  const record = await getSessionById(sessionId);
  const runtime = runtimes.get(sessionId);
  if (runtime) {
    await runtime.provider.stop();
    runtimes.delete(sessionId);
  }

  rejectApprovalsForSession(sessionId);
  await deactivateSession(sessionId);
  if (record) {
    logSessionEvent(record, "session-stop", `${record.alias || record.id} ${remove ? "deleted" : "stopped"}`);
  }

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

async function updateSessionTemplateRequest(sessionId: string, templateId: string): Promise<IPCResponse> {
  const record = await getSessionById(sessionId);
  if (!record) return { ok: false, error: "Session not found" };
  const template = getTemplateById(templateId);
  record.template = template.id;
  record.updatedAt = Date.now();
  await upsertSession(record);
  const runtime = runtimes.get(sessionId);
  if (runtime) {
    runtime.policyRef.current = template;
    runtime.record.template = template.id;
  }
  logSessionEvent(record, "session-update", `Updated signing policy to ${template.label}`);
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
    case "list-activity": {
      return { ok: true, activity: listActivity() };
    }
    case "list-approvals": {
      return { ok: true, approvals: listPendingApprovals() };
    }
    case "resolve-approval": {
      const resolved = resolvePendingApproval(req.approvalId, req.approved);
      if (!resolved) return { ok: false, error: "Approval not found" };
      return { ok: true };
    }
    case "stop-session":
      return stopSession(req.sessionId);
    case "delete-session":
      return stopSession(req.sessionId, true);
    case "rename-session":
      return renameSession(req.sessionId, req.alias);
    case "update-session-template":
      return updateSessionTemplateRequest(req.sessionId, req.template);
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
