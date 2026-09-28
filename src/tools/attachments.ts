import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, Int } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type AttachmentId, type EvoluInstance } from "../evolu.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname } from "path";
import { lookup } from "mime-types";
import { joinChunks, splitIntoChunks } from "./attachmentChunks.js";
import { createMutationWaiter, resolveDownloadPath, resolveUploadPath, assertAttachmentSize } from "./helpers.js";

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
          description: "Optional path to save the attachment to disk, RELATIVE to ~/Downloads (or TODOCKO_DOWNLOAD_DIR); paths escaping that directory are rejected. If provided, writes the file and returns the path instead of base64 content.",
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
    // Confined to the upload directory; see resolveUploadPath (TODO-286).
    const uploadPath = resolveUploadPath(args.filePath);
    if (!existsSync(uploadPath)) {
      throw new Error(`File not found: ${args.filePath}`);
    }

    const fileBuffer = readFileSync(uploadPath);
    fileContent = fileBuffer.toString("base64");
    size = fileBuffer.length;
    filename = args.filename || basename(uploadPath);
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
  assertAttachmentSize(fileContent);

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

  // Obsah jde binárně a po kusech (TODO-396), stejně jako v aplikaci: Evolu
  // 8.12 odmítá mutaci nad 640 000 bajtů a base64 k obsahu přidávalo třetinu.
  const content = Buffer.from(fileContent, "base64");
  const chunks = splitIntoChunks(new Uint8Array(content));

  const waiter = createMutationWaiter();
  const result = evolu.insert("attachment", {
    taskId: args.taskId as TaskId,
    filename: NonEmptyTrimmedString100.orThrow(filename),
    mimeType: mimeType,
    // Prázdné: obsah je v kusech. Sloupec zůstává kvůli starým přílohám.
    data: null,
    size: Int.orThrow(size),
  }, { onComplete: waiter.onComplete });

  const attachmentId = result.id as AttachmentId;
  chunks.forEach((bytes, index) => {
    evolu.insert("attachmentChunk", {
      attachmentId,
      index: Int.orThrow(index),
      bytes,
    });
  });

  await waiter.waitForSync();

  return {
    success: true,
    attachmentId: result.id,
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
      // Bez filtru na `data`: obsah nové přílohy leží v kusech a sloupec je
      // u ní prázdný, takže by z výpisu zmizela. Přišlo se na to sondou,
      // upload i download fungovaly a výpis vracel nulu. (TODO-396)
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
  // Kusy musí odejít s přílohou, jinak zůstane obsah ležet v datech a
  // tombstone uvolní jen hlavičku (TODO-396).
  const chunkQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("attachmentChunk")
      .select(["id"])
      .where("attachmentId", "=", args.id as AttachmentId)
      .where("isDeleted", "is not", SQLITE_TRUE)
  );
  const chunkRows = (await evolu.loadQuery(chunkQuery)) as unknown as Array<{ id: string }>;

  const waiter = createMutationWaiter();
  const result = evolu.update("attachment", {
    id: args.id as AttachmentId,
    data: null,
    isDeleted: SQLITE_TRUE,
  } as any, { onComplete: waiter.onComplete });

  for (const chunk of chunkRows) {
    evolu.update("attachmentChunk", {
      id: chunk.id,
      bytes: new Uint8Array(0),
      isDeleted: SQLITE_TRUE,
    } as any);
  }

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

  // Nové přílohy mají obsah v kusech, staré v `data`. Obojí se čte, protože
  // schéma je append-only a staré řádky nikam nezmizí. (TODO-396)
  const chunkQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("attachmentChunk")
      .select(["index", "bytes"])
      .where("attachmentId", "=", args.id as AttachmentId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("index", "asc")
  );
  const chunkRows = (await evolu.loadQuery(chunkQuery)) as unknown as Array<{ index: number; bytes: Uint8Array }>;
  const joined = chunkRows.length > 0 ? joinChunks(chunkRows.map((r) => ({ index: r.index, bytes: r.bytes }))) : null;

  if (chunkRows.length > 0 && !joined) {
    // Kus chybí: příloha se ještě nesynchronizovala celá. Půlka souboru by se
    // poznala až při otevření, a to je pozdě.
    return { error: "Attachment content is incomplete (some chunks have not synced yet)" };
  }

  const base64 = joined ? Buffer.from(joined).toString("base64") : (a.data as string | null);
  if (!base64) {
    return { error: "Attachment data is empty (may have been deleted)" };
  }

  if (args.savePath) {
    const target = resolveDownloadPath(args.savePath);
    const dir = dirname(target);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(target, Buffer.from(base64, "base64"));
    return {
      success: true,
      filePath: target,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
    };
  }

  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    data: base64,
    size: a.size,
  };
}
