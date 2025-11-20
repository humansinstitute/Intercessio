const DEFAULT_TOPIC = "https://ntfy.sh/5YgcLkpnfy74NKO19uw804ghudf-shush";

type NotificationPayload = {
  title?: string;
  message: string;
  tags?: string[];
  priority?: number;
};

export async function sendNtfyNotification(payload: NotificationPayload) {
  const topic = process.env.INTERCESSIO_NTFY_TOPIC?.trim() || DEFAULT_TOPIC;
  if (!topic) return;
  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
  };
  if (payload.title) headers["Title"] = payload.title;
  if (payload.tags?.length) headers["Tags"] = payload.tags.join(",");
  if (payload.priority) headers["Priority"] = String(payload.priority);

  try {
    await fetch(topic, {
      method: "POST",
      headers,
      body: payload.message,
    });
  } catch (error) {
    console.warn(`Failed to send ntfy notification: ${error instanceof Error ? error.message : String(error)}`);
  }
}
