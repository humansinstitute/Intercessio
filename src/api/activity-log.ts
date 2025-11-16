import { randomUUID } from "node:crypto";

export type ActivityType =
  | "session-start"
  | "session-stop"
  | "session-update"
  | "provider-connect"
  | "provider-disconnect"
  | "sign-request"
  | "sign-result"
  | "nip04"
  | "nip44";

export type ActivityEntry = {
  id: string;
  sessionId?: string;
  sessionLabel?: string;
  type: ActivityType;
  summary: string;
  client?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
};

const MAX_LOG_ENTRIES = 200;
const activityLog: ActivityEntry[] = [];

export function recordActivity(entry: Omit<ActivityEntry, "id" | "timestamp"> & { timestamp?: number }) {
  const enriched: ActivityEntry = {
    id: randomUUID(),
    timestamp: entry.timestamp ?? Date.now(),
    ...entry,
  };
  activityLog.unshift(enriched);
  if (activityLog.length > MAX_LOG_ENTRIES) activityLog.pop();
}

export function listActivity(): ActivityEntry[] {
  return activityLog;
}
