import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, Int } from "@evolu/common";
import {
  SQLITE_TRUE,
  type LocalProjectNoteId,
  type LocalNoteAttachmentId,
  type EvoluInstance,
} from "../evolu.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname } from "path";
import { lookup } from "mime-types";
import { createMutationWaiter, resolveDownloadPath, assertAttachmentSize , assertMutation} from "./helpers.js";

// Attachments for LOCAL project notes (localNoteAttachment table, AppOwner).
// Shared-project note attachments (noteAttachment in ProjectSchema) are not
// covered here — they would need the SharedOwner flow like other shared tools.

export const noteAttachmentTools: Tool[] = [
  {
    name: "td_upload_note_attachment",
    description: "Upload an attachment to a local project note. Provide either a file path or base64-encoded content.",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "Local project note ID (required)" },
        filePath: { type: "string", description: "Path to the file to upload (mutually exclusive with content)" },
        content: { type: "string", description: "Base64-encoded file content (mutually exclusive with filePath)" },
        filename: { type: "string", description: "Filename (required with content, optional for filePath)" },
        mimeType: { type: "string", description: "MIME type (optional - auto-detected from filename)" },
      },
      required: ["noteId"],
    },
  },
  {
    name: "td_list_note_attachments",
    description: "List attachments of a local project note",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string", description: "Local project note ID (required)" },
      },
      required: ["noteId"],
    },
  },
  {
    name: "td_download_note_attachment",
    description: "Download a local note attachment by ID. Returns base64 content, or saves to a file if savePath is given.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note attachment ID (required)" },
        savePath: { type: "string", description: "Optional path to save the file to disk, RELATIVE to ~/Downloads (or TODOCKO_DOWNLOAD_DIR); escapes are rejected" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_note_attachment",
    description: "Delete a local note attachment (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note attachment ID (required)" },
      },
      required: ["id"],
    },
  },
];

export async function handleNoteAttachmentTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_upload_note_attachment":
      return uploadNoteAttachment(evolu, args as { noteId: string; filePath?: string; content?: string; filename?: string; mimeType?: string });
    case "td_list_note_attachments":
      return listNoteAttachments(evolu, args as { noteId: string });
    case "td_download_note_attachment":
      return downloadNoteAttachment(evolu, args as { id: string; savePath?: string });
    case "td_delete_note_attachment":
      return deleteNoteAttachment(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function uploadNoteAttachment(
  evolu: EvoluInstance,
  args: { noteId: string; filePath?: string; content?: string; filename?: string; mimeType?: string }
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
  assertAttachmentSize(fileContent);

  // Verify note exists
  const noteQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("localProjectNote")
      .select(["id"])
      .where("id", "=", args.noteId as LocalProjectNoteId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );
  const noteResult = await evolu.loadQuery(noteQuery);
  if (noteResult.length === 0) {
    throw new Error("Local project note not found");
  }

  const waiter = createMutationWaiter();
  const result = evolu.insert("localNoteAttachment", {
    noteId: args.noteId as LocalProjectNoteId,
    filename: NonEmptyString100.orThrow(filename),
    mimeType,
    data: fileContent,
    size: Int.orThrow(size),
  }, { onComplete: waiter.onComplete });

  if (!result.ok) {
    throw new Error(`Failed to upload note attachment: ${JSON.stringify(result.error)}`);
  }

  await waiter.waitForSync();

  return {
    success: true,
    attachmentId: result.value.id,
    filename,
    mimeType,
    size,
    message: `Attachment "${filename}" uploaded to note successfully`,
  };
}

async function listNoteAttachments(
  evolu: EvoluInstance,
  args: { noteId: string }
) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("localNoteAttachment")
      .select(["id", "filename", "mimeType", "size"])
      .where("noteId", "=", args.noteId as LocalProjectNoteId)
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

async function downloadNoteAttachment(
  evolu: EvoluInstance,
  args: { id: string; savePath?: string }
) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("localNoteAttachment")
      .select(["id", "filename", "mimeType", "data", "size"])
      .where("id", "=", args.id as LocalNoteAttachmentId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return { error: "Note attachment not found" };
  }

  const a = result[0] as any;
  if (!a.data) {
    return { error: "Attachment data is empty (may have been deleted)" };
  }

  if (args.savePath) {
    const target = resolveDownloadPath(args.savePath);
    const dir = dirname(target);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(target, Buffer.from(a.data, "base64"));
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
    data: a.data,
    size: a.size,
  };
}

async function deleteNoteAttachment(
  evolu: EvoluInstance,
  args: { id: string }
) {
  const waiter = createMutationWaiter();
  assertMutation("deleteNoteAttachment",
    evolu.update("localNoteAttachment", {
      id: args.id as LocalNoteAttachmentId,
      data: null,
      isDeleted: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Note attachment deleted successfully",
  };
}
