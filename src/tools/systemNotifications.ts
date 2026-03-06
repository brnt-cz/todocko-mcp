import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { EvoluInstance } from "../evolu.js";

const RELAY_URL = process.env.TODOCKO_RELAY_URL || "https://relay.todocko.cz";
const ADMIN_API_KEY = process.env.TODOCKO_RELAY_ADMIN_KEY || "";

function adminUrl(): string {
  return RELAY_URL.replace(/:4000\/?$/, "").replace(/\/$/, "");
}

async function adminFetch(path: string, options?: RequestInit): Promise<unknown> {
  const url = `${adminUrl()}:4001${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(ADMIN_API_KEY ? { Authorization: `Bearer ${ADMIN_API_KEY}` } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Relay API error ${response.status}: ${body}`);
  }
  return response.json();
}

async function publicFetch(path: string): Promise<unknown> {
  const url = `${adminUrl()}:4000${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Relay API error ${response.status}`);
  }
  return response.json();
}

export const systemNotificationTools: Tool[] = [
  {
    name: "td_list_system_notifications",
    description:
      "List active system/broadcast notifications from the relay server. Returns non-expired notifications visible to all users.",
    inputSchema: {
      type: "object",
      properties: {
        admin: {
          type: "boolean",
          description: "If true, list ALL notifications (including expired) via admin API. Requires TODOCKO_RELAY_ADMIN_KEY.",
        },
      },
    },
  },
  {
    name: "td_create_system_notification",
    description:
      "Create a broadcast notification visible to all Todocko users. Requires TODOCKO_RELAY_ADMIN_KEY env var.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Notification title (required)",
        },
        body: {
          type: "string",
          description: "Notification body (HTML allowed)",
        },
        type: {
          type: "string",
          enum: ["info", "warning", "success"],
          description: "Notification type (default: info)",
        },
        expiresAt: {
          type: "string",
          description: "ISO datetime when the notification expires (optional)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "td_delete_system_notification",
    description:
      "Delete a system notification by ID. Requires TODOCKO_RELAY_ADMIN_KEY env var.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Notification ID to delete (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleSystemNotificationTool(
  name: string,
  args: Record<string, unknown>,
  _evolu: EvoluInstance,
): Promise<unknown> {
  if (name === "td_list_system_notifications") {
    const useAdmin = args.admin === true;
    if (useAdmin) {
      if (!ADMIN_API_KEY) {
        return { error: "TODOCKO_RELAY_ADMIN_KEY not configured" };
      }
      return adminFetch("/api/notifications");
    }
    return publicFetch("/api/notifications");
  }

  if (name === "td_create_system_notification") {
    if (!ADMIN_API_KEY) {
      return { error: "TODOCKO_RELAY_ADMIN_KEY not configured" };
    }
    const { title, body, type, expiresAt } = args as {
      title: string;
      body?: string;
      type?: string;
      expiresAt?: string;
    };
    return adminFetch("/api/notifications", {
      method: "POST",
      body: JSON.stringify({ title, body: body || "", type, expiresAt }),
    });
  }

  if (name === "td_delete_system_notification") {
    if (!ADMIN_API_KEY) {
      return { error: "TODOCKO_RELAY_ADMIN_KEY not configured" };
    }
    const { id } = args as { id: string };
    return adminFetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  return undefined;
}
