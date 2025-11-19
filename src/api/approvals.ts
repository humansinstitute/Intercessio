import { randomUUID } from "node:crypto";

import type { EventTemplate } from "nostr-tools";

import type { SigningTemplate } from "../signingTemplates/types.js";
import {
  ApprovalStatus,
  ApprovalTaskRecord,
  insertApprovalTask,
  listApprovalTasks,
  getApprovalTask,
  updateApprovalTaskStatus,
} from "./db.js";
import { recordActivity } from "./activity-log.js";
import { publishApprovalNotification } from "./ntfy.js";
import { log } from "./logger.js";

function shortText(text: string, size = 16) {
  return text.length <= size ? text : `${text.slice(0, size)}…`;
}

function describeEvent(draft: EventTemplate) {
  const preview = draft.content?.length > 120 ? `${draft.content.slice(0, 120)}…` : draft.content || "";
  return `kind=${draft.kind ?? "?"} tags=${draft.tags?.length ?? 0} content="${preview}"`;
}

export type ApprovalTask = ApprovalTaskRecord & { draft: EventTemplate };

type PendingResolver = {
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const waiters = new Map<string, PendingResolver>();
const orphanTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function serializeDraft(draft: EventTemplate) {
  return JSON.stringify(draft);
}

export function deserializeDraft(json: string): EventTemplate {
  return JSON.parse(json);
}

export async function listPendingApprovals(): Promise<ApprovalTask[]> {
  const rows = await listApprovalTasks(["pending"]);
  return rows.map((row) => ({ ...row, draft: deserializeDraft(row.draftJson) }));
}

export function pendingApprovalCount() {
  return waiters.size;
}

export async function createApprovalTask({
  sessionId,
  sessionAlias,
  sessionType,
  client,
  draft,
  policy,
  expiresAt,
  onExpire,
}: {
  sessionId: string;
  sessionAlias?: string;
  sessionType: "bunker" | "nostr-connect";
  client: string;
  draft: EventTemplate;
  policy: SigningTemplate;
  expiresAt: number;
  onExpire?: () => void;
}): Promise<{ task: ApprovalTask; decision: Promise<boolean> }> {
  const id = randomUUID();
  const createdAt = Date.now();
  const eventSummary = describeEvent(draft);
  const record: ApprovalTaskRecord = {
    id,
    sessionId,
    sessionAlias,
    sessionType,
    client,
    eventKind: draft.kind,
    eventSummary,
    policyId: policy.id,
    policyLabel: policy.label,
    draftJson: serializeDraft(draft),
    createdAt,
    expiresAt,
    status: "pending",
  };

  await insertApprovalTask(record);
  const decision = new Promise<boolean>((resolve) => {
    const timeout = setTimeout(async () => {
      waiters.delete(id);
      await updateApprovalTaskStatus(id, "expired");
      onExpire?.();
      resolve(false);
    }, Math.max(expiresAt - Date.now(), 0));
    waiters.set(id, { resolve, timeout });
  });

  const task: ApprovalTask = { ...record, draft };
  publishApprovalNotification({
    taskId: id,
    sessionAlias,
    sessionId,
    sessionType,
    client,
    eventKind: draft.kind,
    eventSummary,
    policyLabel: policy.label,
    policyId: policy.id,
  }).catch((error) => {
    log.warn(`Failed to publish ntfy notification: ${error instanceof Error ? error.message : String(error)}`);
  });

  return { task, decision };
}

export async function resolveApproval(id: string, status: Exclude<ApprovalStatus, "pending">) {
  const waiter = waiters.get(id);
  if (waiter) {
    clearTimeout(waiter.timeout);
    waiter.resolve(status === "approved");
    waiters.delete(id);
    log.info(`Approval ${status} resolved for task ${id}`);
  } else {
    log.warn(`Approval ${id} resolved without active waiter; status stored only.`);
  }
  await updateApprovalTaskStatus(id, status);
}

export async function summarizePendingApprovals() {
  const pending = await listPendingApprovals();
  return pending.map((task) => ({
    id: task.id,
    sessionId: task.sessionId,
    sessionAlias: task.sessionAlias,
    sessionType: task.sessionType,
    client: shortText(task.client),
    eventKind: task.eventKind,
    eventSummary: task.eventSummary,
    policyId: task.policyId,
    policyLabel: task.policyLabel,
    createdAt: task.createdAt,
    expiresAt: task.expiresAt,
    status: task.status,
  }));
}

export async function expirePendingTask(id: string, metadata?: Record<string, unknown>) {
  await updateApprovalTaskStatus(id, "expired");
  recordActivity({
    type: "sign-result",
    summary: `Expired approval task ${id}`,
    sessionId: metadata?.sessionId as string | undefined,
    sessionLabel: metadata?.sessionLabel as string | undefined,
    metadata,
  });
}

async function scheduleExpiry(task: ApprovalTaskRecord) {
  const now = Date.now();
  if (task.expiresAt <= now) {
    await expirePendingTask(task.id, {
      sessionId: task.sessionId,
      sessionLabel: task.sessionAlias,
      reason: "restored-expired",
    });
    return;
  }
  if (orphanTimers.has(task.id)) return;
  const timeout = setTimeout(() => {
    orphanTimers.delete(task.id);
    expirePendingTask(task.id, { sessionId: task.sessionId, sessionLabel: task.sessionAlias }).catch((error) =>
      log.warn(`Failed to expire approval ${task.id}: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, task.expiresAt - now);
  orphanTimers.set(task.id, timeout);
}

export async function restorePendingApprovalTimers() {
  const pending = await listApprovalTasks(["pending"]);
  await Promise.all(pending.map((task) => scheduleExpiry(task)));
}

export async function getApprovalDetails(id: string) {
  const task = await getApprovalTask(id);
  if (!task) return null;
  const now = Date.now();
  if (task.status === "pending" && task.expiresAt <= now) {
    await expirePendingTask(task.id, { sessionId: task.sessionId, sessionLabel: task.sessionAlias, reason: "expired" });
    return null;
  }
  return { ...task, draft: deserializeDraft(task.draftJson) };
}
