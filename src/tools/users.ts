import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, type UserId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning } from "./helpers.js";

export const userTools: Tool[] = [
  {
    name: "td_list_users",
    description: "List all users in Todocko",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "td_get_user",
    description: "Get a specific user by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "User ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_create_user",
    description: "Create a new user",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "User name (required)",
        },
        email: {
          type: "string",
          description: "User email",
        },
        color: {
          type: "string",
          description: "Hex color for avatar (default: '#6b7280')",
        },
        role: {
          type: "string",
          description: "User role (e.g., 'admin', 'member')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "td_update_user",
    description: "Update a user's profile",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "User ID (required)",
        },
        name: {
          type: "string",
          description: "New user name",
        },
        email: {
          type: "string",
          description: "New email (or null to clear)",
        },
        color: {
          type: "string",
          description: "New hex color",
        },
        role: {
          type: "string",
          description: "New role",
        },
        theme: {
          type: "string",
          description: "Theme preference",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_user",
    description: "Delete a user (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "User ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleUserTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_users":
      return listUsers(evolu);
    case "td_get_user":
      return getUser(evolu, args as { id: string });
    case "td_create_user":
      return createUser(evolu, args as { name: string; email?: string; color?: string; role?: string });
    case "td_update_user":
      return updateUser(evolu, args as { id: string; name?: string; email?: string | null; color?: string; role?: string; theme?: string });
    case "td_delete_user":
      return deleteUser(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listUsers(evolu: EvoluInstance) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("user")
      .select(["id", "name", "email", "color", "role", "avatarUrl"])
      .where("isDeleted", "is not", SQLITE_TRUE)
  );

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    users: result.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      color: u.color,
      role: u.role,
      avatarUrl: u.avatarUrl,
    })),
  };
}

async function getUser(evolu: EvoluInstance, args: { id: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("user")
      .select(["id", "name", "email", "color", "role", "avatarUrl", "theme"])
      .where("id", "=", args.id as UserId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return { error: "User not found" };
  }

  const u = result[0] as any;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    color: u.color,
    role: u.role,
    avatarUrl: u.avatarUrl,
    theme: u.theme,
  };
}

async function createUser(
  evolu: EvoluInstance,
  args: { name: string; email?: string; color?: string; role?: string }
) {
  const waiter = createMutationWaiter();
  const result = evolu.insert("user", {
    name: NonEmptyString100.orThrow(args.name),
    email: args.email ? EvoluString.orThrow(args.email) : null,
    color: EvoluString.orThrow(args.color || "#6b7280"),
    role: args.role ? EvoluString.orThrow(args.role) : null,
    avatarUrl: null,
    passwordHash: null,
    theme: null,
  }, { onComplete: waiter.onComplete });

  if (!result.ok) {
    throw new Error(`Failed to create user: ${JSON.stringify(result.error)}`);
  }

  await waiter.waitForSync();

  return {
    success: true,
    userId: result.value.id,
    message: `User "${args.name}" created successfully${getSyncWarning()}`,
  };
}

async function updateUser(
  evolu: EvoluInstance,
  args: { id: string; name?: string; email?: string | null; color?: string; role?: string; theme?: string }
) {
  const updates: Record<string, unknown> = {
    id: args.id as UserId,
  };

  if (args.name !== undefined) {
    updates.name = NonEmptyString100.orThrow(args.name);
  }
  if (args.email !== undefined) {
    updates.email = args.email ? EvoluString.orThrow(args.email) : null;
  }
  if (args.color !== undefined) {
    updates.color = EvoluString.orThrow(args.color);
  }
  if (args.role !== undefined) {
    updates.role = args.role ? EvoluString.orThrow(args.role) : null;
  }
  if (args.theme !== undefined) {
    updates.theme = args.theme ? EvoluString.orThrow(args.theme) : null;
  }

  const waiter = createMutationWaiter();
  evolu.update("user", updates as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: `User updated successfully${getSyncWarning()}`,
  };
}

async function deleteUser(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  evolu.update("user", {
    id: args.id as UserId,
    isDeleted: SQLITE_TRUE,
  } as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: "User deleted successfully",
  };
}
