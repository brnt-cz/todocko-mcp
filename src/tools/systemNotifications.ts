import { relayHttpBase } from "./pure.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { EvoluInstance } from "../evolu.js";


const ADMIN_API_KEY = process.env.TODOCKO_RELAY_ADMIN_KEY || "";

// Both APIs are reached through the reverse proxy, not on their container ports.
//
// This used to append :4001 for the admin API and :4000 for the public one, and
// neither worked from outside the host: :4000 times out (nothing forwards it) and
// :4001 stopped answering when TODO-223 bound it to 127.0.0.1. The proxy is the
// only supported entrance now, exactly as the app uses it — public endpoints
// under /api/, the admin API under /admin-api/.
function baseUrl(): string {
  return relayHttpBase(process.env.TODOCKO_RELAY_URL);
}

/**
 * Refuse to put the admin key on the wire in clear text. (TODO-441)
 *
 * `TODOCKO_RELAY_URL` accepts `ws://` and `http://` (TODO-266/288), and
 * `adminFetch` attached `Authorization: Bearer <admin key>` to whatever came
 * out of it. Against a plain-http relay that key - which can broadcast to every
 * Todocko user - travels readable to anything on the path. Loopback is exempt:
 * there is no path, and that is how the relay is developed against.
 */
export function assertAdminTransportSafe(url: string): void {
  if (url.startsWith("https://")) return;
  const host = url.replace(/^[a-z]+:\/\//, "").split(/[/:]/)[0];
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return;
  throw new Error(
    `Refusing to send TODOCKO_RELAY_ADMIN_KEY to ${url}: it is not https, so the key ` +
      `would travel in clear text. Point TODOCKO_RELAY_URL at https:// (or wss://), ` +
      `or use a relay on localhost.`,
  );
}

async function adminFetch(path: string, options?: RequestInit): Promise<unknown> {
  const base = baseUrl();
  if (ADMIN_API_KEY) assertAdminTransportSafe(base);
  const url = `${base}/admin-api${path}`;
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
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Relay API error ${response.status}`);
  }
  return response.json();
}

/**
 * The notification tools this installation can actually use. (TODO-441)
 *
 * Creating and deleting a broadcast needs `TODOCKO_RELAY_ADMIN_KEY`, which
 * almost nobody has. They were offered to every client regardless, so each
 * session carried two tool definitions whose only possible answer is a refusal,
 * and an assistant that tried one spent a round trip learning that. The same
 * goes for the `admin` flag on the listing, which is why it is added only with
 * the key; listing the public notifications needs no rights and stays.
 *
 * Takes the key rather than reading the environment so the decision is testable.
 */
export function buildSystemNotificationTools(adminKey: string): Tool[] {
  const listTool: Tool = {
    name: "td_list_system_notifications",
    description:
      "List active system/broadcast notifications from the relay server. Returns non-expired notifications visible to all users.",
    inputSchema: {
      type: "object",
      properties: adminKey
        ? {
            admin: {
              type: "boolean",
              description: "If true, list ALL notifications (including expired) via admin API. Requires TODOCKO_RELAY_ADMIN_KEY.",
            },
          }
        : {},
    },
  };
  return adminKey ? [listTool, ...adminOnlySystemNotificationTools] : [listTool];
}

/**
 * Registered only with an admin key, but still part of the catalogue the README
 * documents and the tests check. (TODO-441)
 */
export const adminOnlySystemNotificationTools: Tool[] = [
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

export const systemNotificationTools: Tool[] = buildSystemNotificationTools(ADMIN_API_KEY);

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
