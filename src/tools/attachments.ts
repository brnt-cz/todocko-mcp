import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, Int } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type AttachmentId, type EvoluInstance } from "../evolu.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname } from "path";
import { lookup } from "mime-types";
import { createMutationWaiter } from "./helpers.js";

export const attachmentTools: Tool[] = [
  {
    name: "td_upload_attachment",
    description: "Upload an attachment to a task. Provide either a file path or base64-encoded content.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
        filePath: {
          type: "string",
          description: "Path to the file to upload (mutually exclusive with content)",
        },
        content: {
          type: "string",
          description: "Base64-encoded file content (mutually exclusive with filePath)",
        },
        filename: {
          type: "string",
          description: "Filename (required if using content, optional for filePath - defaults to basename)",
        },
        mimeType: {
          type: "string",
          description: "MIME type (optional - auto-detected from filename if not provided)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "td_list_attachments",
    description: "List attachments for a specific task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "td_delete_attachment",
    description: "Delete an attachment from a task",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Attachment ID (required)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_download_attachment",
    description: "Download an attachment by ID. Returns base64-encoded content, or saves to a file if savePath is provided.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Attachment ID (required)",
        },
        savePath: {
          type: "string",
          description: "Optional file path to save the attachment to disk. If provided, writes the file and returns the path instead of base64 content.",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleAttachmentTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_upload_attachment":
      return uploadAttachment(evolu, args as {
        taskId: string;
        filePath?: string;
        content?: string;
        filename?: string;
        mimeType?: string;
      });
    case "td_list_attachments":
      return listAttachments(evolu, args as { taskId: string });
    case "td_delete_attachment":
      return deleteAttachment(evolu, args as { id: string });
    case "td_download_attachment":
      return downloadAttachment(evolu, args as { id: string; savePath?: string });
    default:
      return undefined;
  }
}

async function uploadAttachment(
  evolu: EvoluInstance,
  args: {
    taskId: string;
    filePath?: string;
    content?: string;
    filename?: string;
    mimeType?: string;
  }
) {
  if (!args.filePath && !args.content) {
    throw new Error("Either filePath or content is required");
  }
  if (args.filePath && args.content) {
    throw new Error("Provide either filePath or content, not both");
  }

  let fileContent: string;
  let filename: string;
  let mimeType: string;
  let size: number;

  if (args.filePath) {
    if (!existsSync(args.filePath)) {
      throw new Error(`File not found: ${args.filePath}`);
    }

    const fileBuffer = readFileSync(args.filePath);
    fileContent = fileBuffer.toString("base64");
    size = fileBuffer.length;
    filename = args.filename || basename(args.filePath);
    mimeType = args.mimeType || lookup(filename) || "application/octet-stream";
  } else {
    if (!args.filename) {
      throw new Error("filename is required when using content parameter");
    }

    fileContent = args.content!;
    filename = args.filename;
    mimeType = args.mimeType || lookup(filename) || "application/octet-stream";
    size = Math.ceil((fileContent.length * 3) / 4);
  }

  if (filename.length > 100) {
    throw new Error("Filename must be 100 characters or less");
  }

  // Verify task exists
  const taskQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .select(["id"])
      .where("id", "=", args.taskId as TaskId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );
  const taskResult = await evolu.loadQuery(taskQuery);
  if (taskResult.length === 0) {
    throw new Error("Task not found");
  }

  const waiter = createMutationWaiter();
  const result = evolu.insert("attachment", {
    taskId: args.taskId as TaskId,
    filename: NonEmptyString100.orThrow(filename),
    mimeType: mimeType,
    data: fileContent,
    size: Int.orThrow(size),
  }, { onComplete: waiter.onComplete });

  if (!result.ok) {
    throw new Error(`Failed to upload attachment: ${JSON.stringify(result.error)}`);
  }

  await waiter.waitForSync();

  return {
    success: true,
    attachmentId: result.value.id,
    filename,
    mimeType,
    size,
    message: `Attachment "${filename}" uploaded successfully`,
  };
}

async function listAttachments(
  evolu: EvoluInstance,
  args: { taskId: string }
) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("attachment")
      .select(["id", "filename", "mimeType", "size"])
      .where("taskId", "=", args.taskId as TaskId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .where("data", "is not", null)
  );

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    attachments: result.map((a: any) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
    })),
  };
}

async function deleteAttachment(
  evolu: EvoluInstance,
  args: { id: string }
) {
  const waiter = createMutationWaiter();
  evolu.update("attachment", {
    id: args.id as AttachmentId,
    data: null,
    isDeleted: SQLITE_TRUE,
  } as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: "Attachment deleted successfully",
  };
}

async function downloadAttachment(
  evolu: EvoluInstance,
  args: { id: string; savePath?: string }
) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("attachment")
      .select(["id", "filename", "mimeType", "data", "size"])
      .where("id", "=", args.id as AttachmentId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return { error: "Attachment not found" };
  }

  const a = result[0] as any;
  if (!a.data) {
    return { error: "Attachment data is empty (may have been deleted)" };
  }

  if (args.savePath) {
    const dir = dirname(args.savePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(args.savePath, Buffer.from(a.data, "base64"));
    return {
      success: true,
      filePath: args.savePath,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
    };
  }

  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    data: a.data,
    size: a.size,
  };
}
