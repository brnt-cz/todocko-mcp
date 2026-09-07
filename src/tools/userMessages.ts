import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { relayHttpBase } from "./pure.js";
import { getAppOwnerId } from "../evolu.js";
import { signOwnerRequest } from "../utils/ownerSignature.js";

/**
 * The relay's per-user message store, `/api/messages` (TODO-112).
 *
 * These are the bug reports, feature requests and notes users send from the
 * app, addressed to whoever holds an admin owner id. MCP wrapped
 * `/api/notifications` (broadcasts going the other way) but not these, so the
 * one direction where users write to you had no tools at all.
 *
 * Listing and deleting are admin-owner only and, since TODO-90 H2, are not
 * satisfied by knowing an ownerId: the relay wants an Ed25519 signature and
 * derives the admin check from the verified signer. Submitting is deliberately
 * unauthenticated on the relay, so it needs no signature here either.
 */

function baseUrl(): string {
  return relayHttpBase(process.env.TODOCKO_RELAY_URL);
}

/**
 * Both signed endpoints need the same three things, and the path has to be
 * built once and used verbatim: it is part of the signed payload, so a path
 * assembled twice is a signature that will not verify.
 */
async function signedFetch(method: "GET" | "DELETE", path: string): Promise<Response> {
  const ownerId = getAppOwnerId();
  if (!ownerId) {
    throw new Error("Evolu is not initialized yet, so there is no owner to sign as");
  }
  const mnemonic = process.env.TODOCKO_MNEMONIC;
  if (!mnemonic) {
    throw new Error("TODOCKO_MNEMONIC is required to sign an owner-authenticated request");
  }

  const headers = await signOwnerRequest(ownerId, mnemonic, method, path);
  return fetch(`${baseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * The relay answers 401 for an unregistered key and 403 for a non-admin, and
 * 200 with an empty list for a verified non-admin. Saying which is which saves
 * the caller guessing whether they are not an admin or never registered.
 */
function explainAuthFailure(status: number, body: string): string {
  if (status === 401) {
    return `Relay rejected the signature (401): ${body}. If the reason is owner_not_registered, open the Todocko app once with this mnemonic so it registers the public key with the relay.`;
  }
  if (status === 403) {
    return `This owner is not an admin owner on the relay (403): ${body}`;
  }
  return `Relay API error ${status}: ${body}`;
}

export const userMessageTools: Tool[] = [
  {
    name: "td_list_user_messages",
    description:
      "List messages users have sent from the app (bug reports, feature requests, notes). Admin owners only; the request is signed with the configured mnemonic. A verified non-admin owner gets an empty list.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bug", "feature", "message"],
          description: "Only messages of this type",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: all)",
        },
      },
    },
  },
  {
    name: "td_submit_user_message",
    description:
      "Send a message to the Todocko admins (bug report, feature request or note), the same way the app's feedback form does. Needs no admin rights.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short subject (required)" },
        body: { type: "string", description: "Message body" },
        type: {
          type: "string",
          enum: ["bug", "feature", "message"],
          description: "Message type (default: message)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "td_delete_user_message",
    description:
      "Delete one user message from the relay. Admin owners only; the request is signed with the configured mnemonic. This is a hard delete on the relay, not a soft one.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Message ID (required)" },
      },
      required: ["id"],
    },
  },
];

export async function handleUserMessageTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "td_list_user_messages":
      return listUserMessages(args as { type?: string; limit?: number });
    case "td_submit_user_message":
      return submitUserMessage(args as { title: string; body?: string; type?: string });
    case "td_delete_user_message":
      return deleteUserMessage(args as { id: string });
    default:
      return undefined;
  }
}

async function listUserMessages(args: { type?: string; limit?: number }) {
  const ownerId = getAppOwnerId();
  if (!ownerId) {
    throw new Error("Evolu is not initialized yet, so there is no owner to sign as");
  }

  // The app sends ownerId in the query string too. It is not what authorises
  // the call any more, but it stays part of the signed path, so it has to be
  // here as well.
  const path = `/api/messages?ownerId=${encodeURIComponent(ownerId)}`;
  const response = await signedFetch("GET", path);
  if (!response.ok) {
    throw new Error(explainAuthFailure(response.status, await response.text().catch(() => "")));
  }

  const raw = (await response.json()) as unknown;
  const all = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const filtered = args.type ? all.filter((m) => m.type === args.type) : all;
  const limited = args.limit ? filtered.slice(0, args.limit) : filtered;

  return {
    count: limited.length,
    totalCount: filtered.length,
    // An admin owner with nothing in the store and a verified non-admin owner
    // both get an empty list from the relay, so say which this was.
    isAdminOwner: true,
    messages: limited,
  };
}

async function submitUserMessage(args: { title: string; body?: string; type?: string }) {
  const ownerId = getAppOwnerId();
  if (!ownerId) {
    throw new Error("Evolu is not initialized yet, so there is no sender id to send");
  }

  const response = await fetch(`${baseUrl()}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderOwnerId: ownerId,
      title: args.title,
      body: args.body,
      type: args.type || "message",
    }),
  });
  if (!response.ok) {
    throw new Error(`Relay API error ${response.status}: ${await response.text().catch(() => "")}`);
  }

  return { success: true, message: (await response.json()) as unknown };
}

async function deleteUserMessage(args: { id: string }) {
  const ownerId = getAppOwnerId();
  if (!ownerId) {
    throw new Error("Evolu is not initialized yet, so there is no owner to sign as");
  }

  const path = `/api/messages/${encodeURIComponent(args.id)}?ownerId=${encodeURIComponent(ownerId)}`;
  const response = await signedFetch("DELETE", path);
  if (response.status === 404) {
    throw new Error(`Message ${args.id} not found on the relay`);
  }
  if (!response.ok) {
    throw new Error(explainAuthFailure(response.status, await response.text().catch(() => "")));
  }

  return { success: true, deletedId: args.id };
}
