type NotificationPayload = {
  title?: string;
  message: string;
  tags?: string[];
  priority?: number;
};

export async function sendNtfyNotification(payload: NotificationPayload) {
  const topic = (process.env.NTFY_TOPIC || process.env.INTERCESSIO_NTFY_TOPIC || "").trim();
  if (!topic) return;
  const url = `https://ntfy.sh/${topic.replace(/^https?:\/\//, "")}`;
  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
  };
  if (payload.title) headers["Title"] = payload.title;
  if (payload.tags?.length) headers["Tags"] = payload.tags.join(",");
  if (payload.priority) headers["Priority"] = String(payload.priority);

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: payload.message,
    });
  } catch (error) {
    console.warn(`Failed to send ntfy notification: ${error instanceof Error ? error.message : String(error)}`);
  }
}
