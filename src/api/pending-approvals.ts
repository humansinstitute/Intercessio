import { randomUUID } from "node:crypto";
import type { EventTemplate } from "nostr-tools";

type PolicySummary = {
  id: string;
  label: string;
};

export type PendingApproval = {
  id: string;
  sessionId: string;
  sessionLabel?: string;
  client: string;
  description: string;
  draft: EventTemplate;
  policy: PolicySummary;
  createdAt: number;
};

type PendingApprovalRecord = PendingApproval & {
  resolveDecision: (approved: boolean) => void;
};

const approvals = new Map<string, PendingApprovalRecord>();

export type PendingApprovalInput = Omit<PendingApproval, "id" | "createdAt">;

export function createPendingApproval(input: PendingApprovalInput) {
  const id = randomUUID();
  const createdAt = Date.now();
  let resolveDecision: (approved: boolean) => void = () => {};
  const decision = new Promise<boolean>((resolve) => {
    resolveDecision = resolve;
  });
  const record: PendingApprovalRecord = {
    ...input,
    id,
    createdAt,
    resolveDecision,
  };
  approvals.set(id, record);
  return { id, decision };
}

export function listPendingApprovals(): PendingApproval[] {
  return Array.from(approvals.values()).map(({ resolveDecision, ...rest }) => ({ ...rest }));
}

export function resolvePendingApproval(id: string, approved: boolean): boolean {
  const record = approvals.get(id);
  if (!record) return false;
  approvals.delete(id);
  record.resolveDecision(approved);
  return true;
}

export function rejectApprovalsForSession(sessionId: string) {
  for (const [id, record] of approvals.entries()) {
    if (record.sessionId !== sessionId) continue;
    approvals.delete(id);
    record.resolveDecision(false);
  }
}
