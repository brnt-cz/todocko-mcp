import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type MentionId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, waitForSync, getSyncWarning , assertMutation} from "./helpers.js";

export const mentionTools: Tool[] = [
  {
    name: "td_list_mentions",
    description: "List @mentions for the current user or all mentions. Filter by read/unread status.",
    inputSchema: {
      type: "object",
      properties: {
        mentionedUserId: {
          type: "string",
          description: "Filter by mentioned user ID",
        },
        isRead: {
          type: "boolean",
          description: "Filter by read status (true=read, false=unread, omit=all)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 50)",
        },
      },
    },
  },
  {
    name: "td_create_mention",
    description: "Create a @mention notification",
    inputSchema: {
      type: "object",
      properties: {
        mentionedUserId: {
          type: "string",
          description: "User ID being mentioned (required)",
        },
        mentionedByUserId: {
          type: "string",
          description: "User ID who created the mention",
        },
        taskId: {
          type: "string",
          description: "Task ID where the mention occurred",
        },
        sourceType: {
          type: "string",
          enum: ["description", "comment"],
          description: "Where the mention was made (required)",
        },
        sourceId: {
          type: "string",
          description: "Comment ID if sourceType is 'comment'",
        },
      },
      required: ["mentionedUserId", "sourceType"],
    },
  },
  {
    name: "td_mark_mention_read",
    description: "Mark a specific mention as read",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Mention ID (required)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_mark_all_mentions_read",
    description: "Mark all unread mentions as read for a user",
    inputSchema: {
      type: "object",
      properties: {
        mentionedUserId: {
          type: "string",
          description: "User ID whose mentions to mark as read (required)",
        },
      },
      required: ["mentionedUserId"],
    },
  },
  {
    name: "td_delete_mention",
    description: "Delete a mention (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Mention ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleMentionTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_mentions":
      return listMentions(evolu, args as { mentionedUserId?: string; isRead?: boolean; limit?: number });
    case "td_create_mention":
      return createMention(evolu, args as {
        mentionedUserId: string;
        mentionedByUserId?: string;
        taskId?: string;
        sourceType: string;
        sourceId?: string;
      });
    case "td_mark_mention_read":
      return markMentionRead(evolu, args as { id: string });
    case "td_mark_all_mentions_read":
      return markAllMentionsRead(evolu, args as { mentionedUserId: string });
    case "td_delete_mention":
      return deleteMention(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listMentions(
  evolu: EvoluInstance,
  args: { mentionedUserId?: string; isRead?: boolean; limit?: number }
) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("mention")
      .leftJoin("task", "mention.taskId", "task.id")
      .select([
        "mention.id",
        "mention.mentionedUserId",
        "mention.mentionedByUserId",
        "mention.taskId",
        "mention.sourceType",
        "mention.sourceId",
        "mention.isRead",
        "mention.createdAt",
        "task.title as taskCode",
        "task.name as taskName",
      ])
      .where("mention.isDeleted", "is not", SQLITE_TRUE)
      .orderBy("mention.createdAt", "desc");

    if (args.mentionedUserId) {
      q = q.where("mention.mentionedUserId", "=", args.mentionedUserId);
    }
    if (args.isRead === true) {
      q = q.where("mention.isRead", "=", SQLITE_TRUE);
    } else if (args.isRead === false) {
      q = q.where("mention.isRead", "is not", SQLITE_TRUE);
    }

    return q.limit(args.limit || 50);
  });

  const result = await evolu.loadQuery(query);
  const unreadCount = result.filter((m: any) => m.isRead !== SQLITE_TRUE).length;

  return {
    count: result.length,
    unreadCount,
    mentions: result.map((m: any) => ({
      id: m.id,
      mentionedUserId: m.mentionedUserId,
      mentionedByUserId: m.mentionedByUserId,
      taskId: m.taskId,
      taskCode: m.taskCode,
      taskName: m.taskName,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      isRead: m.isRead === SQLITE_TRUE,
      createdAt: m.createdAt,
    })),
  };
}

async function createMention(
  evolu: EvoluInstance,
  args: {
    mentionedUserId: string;
    mentionedByUserId?: string;
    taskId?: string;
    sourceType: string;
    sourceId?: string;
  }
) {
  const waiter = createMutationWaiter();
  const result = evolu.insert("mention", {
    mentionedUserId: EvoluString.orThrow(args.mentionedUserId),
    mentionedByUserId: args.mentionedByUserId ? EvoluString.orThrow(args.mentionedByUserId) : null,
    taskId: args.taskId ? (args.taskId as TaskId) : null,
    sourceType: EvoluString.orThrow(args.sourceType),
    sourceId: args.sourceId ? EvoluString.orThrow(args.sourceId) : null,
    isRead: null,
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    mentionId: result.id,
    message: `Mention created successfully${getSyncWarning()}`,
  };
}

async function markMentionRead(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("markMentionRead",
    evolu.update("mention", {
      id: args.id as MentionId,
      isRead: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Mention marked as read",
  };
}

async function markAllMentionsRead(evolu: EvoluInstance, args: { mentionedUserId: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("mention")
      .select(["id"])
      .where("mentionedUserId", "=", args.mentionedUserId)
      .where("isRead", "is not", SQLITE_TRUE)
      .where("isDeleted", "is not", SQLITE_TRUE)
  );

  const unread = await evolu.loadQuery(query);
  let count = 0;

  for (const m of unread) {
    assertMutation("markAllMentionsRead",
      evolu.update("mention", {
        id: (m as any).id as MentionId,
        isRead: SQLITE_TRUE,
      } as any)
    );
    count++;
  }

  await waitForSync();

  return {
    success: true,
    markedCount: count,
    message: `${count} mentions marked as read`,
  };
}

async function deleteMention(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("deleteMention",
    evolu.update("mention", {
      id: args.id as MentionId,
      isDeleted: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Mention deleted successfully",
  };
}
