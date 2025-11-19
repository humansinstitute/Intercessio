import { log } from "./logger.js";
import { shortText } from "./provider.js";

type ApprovalNotification = {
  taskId: string;
  sessionId: string;
  sessionAlias?: string;
  sessionType: "bunker" | "nostr-connect";
  client: string;
  eventKind?: number;
  eventSummary?: string;
  policyLabel: string;
  policyId: string;
};

const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_BASE_URL = (process.env.NTFY_BASE_URL || "https://ntfy.sh").replace(/\/$/, "");
const IC_LINK = process.env.IC_LINK?.replace(/\/$/, "");

export async function publishApprovalNotification(notification: ApprovalNotification) {
  if (!NTFY_TOPIC) {
    log.debug("NTFY_TOPIC not set; skipping approval notification publish.");
    return;
  }
  const url = `${NTFY_BASE_URL}/${NTFY_TOPIC}`;
  const title = "Intercessio approval required";
  const session = notification.sessionAlias || notification.sessionId;
  const summary = notification.eventSummary ? `Event: ${notification.eventSummary}` : undefined;
  const approvalLink = IC_LINK ? `${IC_LINK}/approvals/${notification.taskId}` : undefined;
  const lines = [
    `Session ${session}`,
    `Client: ${shortText(notification.client)}`,
    `Kind: ${notification.eventKind ?? "?"}`,
    `Policy: ${notification.policyLabel}`,
  ];
  if (summary) lines.push(summary);
  if (approvalLink) lines.push(`Review: ${approvalLink}`);
  const body = lines.join("\n");
  const tags = [`sign`, `policy:${notification.policyId}`, notification.sessionType];

  const headers: Record<string, string> = {
    Title: title,
    Tags: tags.join(","),
  };

  log.info(`ntfy publish requested`, `topic=${NTFY_TOPIC} url=${url} body="${body}"`);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`ntfy publish failed with status ${response.status}`);
  }
}
