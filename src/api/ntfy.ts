type NotificationViewAction = {
  type: "view";
  label?: string;
  url: string;
  clear?: boolean;
};

type NotificationHttpAction = {
  type: "http";
  label?: string;
  url: string;
  clear?: boolean;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

type NotificationAction = NotificationViewAction | NotificationHttpAction;

type NotificationPayload = {
  title?: string;
  message: string;
  tags?: string[];
  priority?: number;
  actions?: NotificationAction[];
};

export async function sendNtfyNotification(payload: NotificationPayload) {
  const topic = (process.env.NTFY_TOPIC || process.env.INTERCESSIO_NTFY_TOPIC || "").trim();
  if (!topic) return;
  const body: Record<string, any> = {
    topic,
    message: payload.message,
  };
  if (payload.title) body.title = payload.title;
  if (payload.tags?.length) body.tags = payload.tags;
  if (payload.priority) body.priority = payload.priority;
  if (payload.actions?.length) {
    body.actions = payload.actions.map((action) => {
      if (action.type === "http") {
        return {
          action: "http",
          label: action.label,
          url: action.url,
          clear: action.clear,
          method: action.method,
          body: action.body,
          headers: action.headers,
        };
      }
      return {
        action: "view",
        label: action.label,
        url: action.url,
        clear: action.clear,
      };
    });
  }

  try {
    await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.warn(`Failed to send ntfy notification: ${error instanceof Error ? error.message : String(error)}`);
  }
}
