import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, NonEmptyString1000, Int, String as EvoluString } from "@evolu/common";
import {
  SQLITE_TRUE,
  type TaskId,
  type ProjectId,
  type UserId,
  type DeploymentStageId,
  type RepositoryLinkId,
  type ProjectMemberId,
  type ProjectNoteId,
  type NoteAttachmentId,
  type WorklogId,
  type ChecklistItemId,
  type TaskCommentId,
  type AttachmentId,
  type TagId,
  type TaskTagId,
  type EvoluInstance,
  getProjectEvolu,
  getSharedOwner,
  useSharedOwner,
  stopUsingSharedOwner,
} from "../evolu.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname } from "path";
import { lookup } from "mime-types";
import { createMutationWaiter, assertMaxLength, NonEmptyString10000, MAX_DESCRIPTION_LENGTH, resolveDownloadPath, assertAttachmentSize, topPositionForNewTask } from "./helpers.js";

export const sharedTools: Tool[] = [
  {
    name: "td_list_shared_projects",
    description: "List all shared projects the user has access to. Returns project references with owner info.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: {
          type: "boolean",
          description: "Include archived projects (default: false)",
        },
      },
    },
  },
  {
    name: "td_list_shared_tasks",
    description: "List tasks from a shared project. Requires sharedOwnerId from td_list_shared_projects.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Filter by status",
        },
        limit: {
          type: "number",
          description: "Maximum number of tasks to return (default: 50)",
        },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_list_shared_deployment_stages",
    description: "List deployment stages for a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  // --- Project tags in shared projects (TODO-235) ---
  //
  // The app has had these since TODO-227; this server only knew about tags in
  // the app instance, so a shared project's tags were invisible to it.
  {
    name: "td_list_shared_tags",
    description: "List project tags in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_create_shared_tag",
    description: "Create a project tag in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        projectId: { type: "string", description: "Project ID inside the shared owner (required)" },
        name: { type: "string", description: "Tag name (required)" },
        color: { type: "string", description: "Hex color (default: '#6b7280')" },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId", "name"],
    },
  },
  {
    name: "td_update_shared_tag",
    description: "Rename a project tag or change its color in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Tag ID (required)" },
        name: { type: "string", description: "New name" },
        color: { type: "string", description: "New hex color" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_tag",
    description: "Delete a project tag in a shared project (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Tag ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_add_shared_tag_to_task",
    description: "Assign a project tag to a task in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
        tagId: { type: "string", description: "Tag ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId", "tagId"],
    },
  },
  {
    name: "td_remove_shared_tag_from_task",
    description: "Remove a project tag from a task in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
        tagId: { type: "string", description: "Tag ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId", "tagId"],
    },
  },
  {
    name: "td_update_shared_task",
    description: "Update a task in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
        id: {
          type: "string",
          description: "Task ID (required)",
        },
        name: {
          type: "string",
          description: "Human-readable task name/summary",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Task status",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Task priority",
        },
        isOnProduction: {
          type: "boolean",
          description: "Set production badge",
        },
        description: {
          type: "string",
          description: "Task description (HTML supported)",
        },
        deadline: {
          type: "string",
          description: "Deadline in ISO format, or null to clear",
        },
        scheduledDate: {
          type: "string",
          description: "Scheduled date (YYYY-MM-DD), or null to clear",
        },
        assigneeId: {
          type: "string",
          description: "User ID to assign, or null to unassign",
        },
        estimate: {
          type: "number",
          description: "Time estimate in minutes",
        },
        isBlocked: {
          type: "boolean",
          description: "Set blocked status",
        },
        blockedReason: {
          type: "string",
          description: "Reason for being blocked",
        },
        deploymentStageId: {
          type: "string",
          description: "Deployment stage ID, or null to clear",
        },
        recurrenceType: {
          type: "string",
          enum: ["none", "daily", "weekly", "monthly", "yearly", "custom"],
          description: "Recurrence type",
        },
        recurrenceInterval: {
          type: "number",
          description: "Recurrence interval (e.g., every 2 weeks)",
        },
        recurrenceEndDate: {
          type: "string",
          description: "Recurrence end date (ISO format), or null to clear",
        },
        recurrenceDay: {
          type: "string",
          description: "Recurrence day: for weekly=1-7 (Mon-Sun ISO), for monthly=1-31 (day of month) or 0 (last day), or null to clear",
        },
        sprintNumber: {
          type: "number",
          description: "Sprint number for the task, or null to clear",
        },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_create_shared_task",
    description: "Create a task in a shared project. Requires sharedOwnerId + ownerSecret from td_list_shared_projects. The task code is auto-generated from the project code unless 'code' is provided.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        projectId: { type: "string", description: "Project ID within the shared project (required)" },
        name: { type: "string", description: "Human-readable task name/summary" },
        description: { type: "string", description: "Task description (HTML supported)" },
        status: { type: "string", enum: ["backlog", "todo", "in_progress", "review", "done"], description: "Task status (default: todo)" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Task priority (default: medium)" },
        deadline: { type: "string", description: "Deadline in ISO format" },
        scheduledDate: { type: "string", description: "Scheduled date (YYYY-MM-DD)" },
        assigneeId: { type: "string", description: "User ID to assign" },
        estimate: { type: "number", description: "Time estimate in minutes" },
        isOnProduction: { type: "boolean", description: "Set production badge" },
        recurrenceType: { type: "string", enum: ["none", "daily", "weekly", "monthly", "yearly", "custom"], description: "Recurrence type" },
        recurrenceInterval: { type: "number", description: "Recurrence interval (e.g., every 2 weeks)" },
        recurrenceEndDate: { type: "string", description: "Recurrence end date (ISO format)" },
        recurrenceDay: { type: "string", description: "Recurrence day: weekly=1-7 (Mon-Sun), monthly=1-31 or 0 (last day)" },
        sprintNumber: { type: "number", description: "Sprint number" },
        parentTaskId: { type: "string", description: "Parent task ID to create this as a sub-task" },
        code: { type: "string", description: "Override auto-generated task code (e.g., 'PROJ-12'). Must match the project code format." },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId"],
    },
  },
  {
    name: "td_delete_shared_task",
    description: "Soft-delete a task in a shared project (cascades to its checklist items and comments). Requires sharedOwnerId + ownerSecret from td_list_shared_projects.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Task ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_list_shared_worklogs",
    description: "List worklogs for a task in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId"],
    },
  },
  {
    name: "td_add_shared_worklog",
    description: "Add a worklog to a task in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
        durationMinutes: { type: "number", description: "Duration in minutes (required)" },
        description: { type: "string", description: "Description of work done" },
        loggedAt: { type: "string", description: "Date when work was done (YYYY-MM-DD, default: today)" },
        userId: { type: "string", description: "User ID who did the work (optional)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId", "durationMinutes"],
    },
  },
  {
    name: "td_delete_shared_worklog",
    description: "Soft-delete a worklog in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Worklog ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_list_shared_checklist_items",
    description: "List checklist items for a task in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId"],
    },
  },
  {
    name: "td_create_shared_checklist_item",
    description: "Create a checklist item on a task in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
        title: { type: "string", description: "Checklist item text (required)" },
        position: { type: "number", description: "Position (default: appended to the end)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId", "title"],
    },
  },
  {
    name: "td_update_shared_checklist_item",
    description: "Update a checklist item in a shared project (toggle done, rename, reorder).",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Checklist item ID (required)" },
        title: { type: "string", description: "New text" },
        isChecked: { type: "boolean", description: "Checked state" },
        position: { type: "number", description: "New position" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_checklist_item",
    description: "Soft-delete a checklist item in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Checklist item ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_list_shared_task_comments",
    description: "List comments for a task in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId"],
    },
  },
  {
    name: "td_create_shared_task_comment",
    description: "Add a comment to a task in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
        content: { type: "string", description: "Comment content, HTML supported (required)" },
        userId: { type: "string", description: "AppOwner OwnerId of the author (optional)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId", "content"],
    },
  },
  {
    name: "td_update_shared_task_comment",
    description: "Update a comment in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Comment ID (required)" },
        content: { type: "string", description: "New comment content (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id", "content"],
    },
  },
  {
    name: "td_delete_shared_task_comment",
    description: "Soft-delete a comment in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Comment ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_create_shared_deployment_stage",
    description: "Create a deployment stage in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
        projectId: {
          type: "string",
          description: "Project ID within the shared owner (required)",
        },
        name: {
          type: "string",
          description: "Stage name (e.g., 'Test', 'Stage', 'Prod') (required)",
        },
        color: {
          type: "string",
          description: "Hex color for badge (e.g., '#22c55e')",
        },
        position: {
          type: "number",
          description: "Order position (default: 0)",
        },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId", "name"],
    },
  },
  {
    name: "td_list_shared_repository_links",
    description: "List repository links for a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_create_shared_repository_link",
    description: "Create a repository link in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
        projectId: {
          type: "string",
          description: "Project ID within the shared owner (required)",
        },
        type: {
          type: "string",
          enum: ["github", "gitlab", "bitbucket", "azure", "custom"],
          description: "Repository type (default: 'github')",
        },
        url: {
          type: "string",
          description: "Repository URL (required)",
        },
        label: {
          type: "string",
          description: "Optional label (e.g., 'Frontend', 'API')",
        },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId", "url"],
    },
  },
  {
    name: "td_update_shared_repository_link",
    description: "Update a repository link in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Repository link ID (required)" },
        type: { type: "string", enum: ["github", "gitlab", "bitbucket", "azure", "custom"], description: "Repository type" },
        url: { type: "string", description: "Repository URL" },
        label: { type: "string", description: "Label, or empty string to clear" },
        position: { type: "number", description: "Order position" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_repository_link",
    description: "Soft-delete a repository link in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Repository link ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_update_shared_deployment_stage",
    description: "Update a deployment stage in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Deployment stage ID (required)" },
        name: { type: "string", description: "Stage name" },
        color: { type: "string", description: "Hex color for badge" },
        position: { type: "number", description: "Order position" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_deployment_stage",
    description: "Soft-delete a deployment stage in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Deployment stage ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_update_shared_project",
    description: "Update shared-project metadata (archive / hide from filters). Finds the project owned by the given sharedOwnerId.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        isArchived: { type: "boolean", description: "Archive / unarchive the project" },
        isHiddenFromFilters: { type: "boolean", description: "Hide the project from filters" },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_upload_shared_attachment",
    description: "Upload a file attachment to a task in a shared project. Provide either filePath or base64 content.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
        filePath: { type: "string", description: "Absolute path to the file to upload (or use content)" },
        content: { type: "string", description: "Base64-encoded file content (or use filePath)" },
        filename: { type: "string", description: "File name (required when using content)" },
        mimeType: { type: "string", description: "MIME type (auto-detected from filename if omitted)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId"],
    },
  },
  {
    name: "td_list_shared_attachments",
    description: "List file attachments of a task in a shared project (metadata only, no data).",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        taskId: { type: "string", description: "Task ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "taskId"],
    },
  },
  {
    name: "td_download_shared_attachment",
    description: "Download a task attachment from a shared project. Returns base64 data, or writes to savePath if provided.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Attachment ID (required)" },
        savePath: { type: "string", description: "Path to write the file to (optional), RELATIVE to ~/Downloads (or TODOCKO_DOWNLOAD_DIR); escapes are rejected" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_attachment",
    description: "Soft-delete a task attachment in a shared project.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Attachment ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_list_shared_members",
    description: "List members of a shared project (name, permission, kicked/blocked state)",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        projectId: { type: "string", description: "Filter by project ID within the shared owner (optional)" },
        includeKicked: { type: "boolean", description: "Include kicked members (default: false)" },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_update_shared_member",
    description: "Update a shared project member: change permission, block/unblock or kick.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "ProjectMember ID (required)" },
        permission: { type: "string", enum: ["admin", "write", "read"], description: "New permission level" },
        isBlocked: { type: "boolean", description: "Block (true) or unblock (false) the member's access" },
        isKicked: { type: "boolean", description: "Kick (true) the member from the project" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_upload_shared_note_attachment",
    description: "Upload an attachment to a note in a shared project. Provide either a file path or base64-encoded content.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        noteId: { type: "string", description: "Shared project note ID (required)" },
        filePath: { type: "string", description: "Path to the file to upload (mutually exclusive with content)" },
        content: { type: "string", description: "Base64-encoded file content (mutually exclusive with filePath)" },
        filename: { type: "string", description: "Filename (required with content, optional for filePath)" },
        mimeType: { type: "string", description: "MIME type (optional - auto-detected from filename)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "noteId"],
    },
  },
  {
    name: "td_list_shared_note_attachments",
    description: "List attachments of a note in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        noteId: { type: "string", description: "Shared project note ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "noteId"],
    },
  },
  {
    name: "td_download_shared_note_attachment",
    description: "Download a shared note attachment by ID. Returns base64 content, or saves to a file if savePath is given.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Note attachment ID (required)" },
        savePath: { type: "string", description: "Optional path to save the file to disk, RELATIVE to ~/Downloads (or TODOCKO_DOWNLOAD_DIR); escapes are rejected" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_note_attachment",
    description: "Delete a shared note attachment (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "Note attachment ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
];

export async function handleSharedTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_shared_projects":
      return listSharedProjects(evolu, args as { includeArchived?: boolean });
    case "td_list_shared_tasks":
      return listSharedTasks(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        status?: string;
        limit?: number;
      });
    case "td_list_shared_deployment_stages":
      return listSharedDeploymentStages(args as {
        sharedOwnerId: string;
        ownerSecret: string;
      });
    case "td_update_shared_task":
      return updateSharedTask(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        id: string;
        name?: string;
        description?: string;
        status?: string;
        priority?: string;
        deadline?: string | null;
        scheduledDate?: string | null;
        assigneeId?: string | null;
        estimate?: number;
        isBlocked?: boolean;
        blockedReason?: string;
        isOnProduction?: boolean;
        deploymentStageId?: string | null;
        recurrenceType?: string;
        recurrenceInterval?: number;
        recurrenceEndDate?: string | null;
        recurrenceDay?: string | null;
        sprintNumber?: number | null;
      });
    case "td_create_shared_task":
      return createSharedTask(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        projectId: string;
        name?: string;
        description?: string;
        status?: string;
        priority?: string;
        deadline?: string;
        scheduledDate?: string;
        assigneeId?: string;
        estimate?: number;
        isOnProduction?: boolean;
        recurrenceType?: string;
        recurrenceInterval?: number;
        recurrenceEndDate?: string;
        recurrenceDay?: string;
        sprintNumber?: number;
        parentTaskId?: string;
        code?: string;
      });
    case "td_delete_shared_task":
      return deleteSharedTask(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        id: string;
      });
    case "td_list_shared_worklogs":
      return listSharedWorklogs(args as { sharedOwnerId: string; ownerSecret: string; taskId: string });
    case "td_add_shared_worklog":
      return addSharedWorklog(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        taskId: string;
        durationMinutes: number;
        description?: string;
        loggedAt?: string;
        userId?: string;
      });
    case "td_delete_shared_worklog":
      return deleteSharedWorklog(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    case "td_list_shared_checklist_items":
      return listSharedChecklistItems(args as { sharedOwnerId: string; ownerSecret: string; taskId: string });
    case "td_create_shared_checklist_item":
      return createSharedChecklistItem(args as { sharedOwnerId: string; ownerSecret: string; taskId: string; title: string; position?: number });
    case "td_update_shared_checklist_item":
      return updateSharedChecklistItem(args as { sharedOwnerId: string; ownerSecret: string; id: string; title?: string; isChecked?: boolean; position?: number });
    case "td_delete_shared_checklist_item":
      return deleteSharedChecklistItem(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    case "td_list_shared_task_comments":
      return listSharedTaskComments(args as { sharedOwnerId: string; ownerSecret: string; taskId: string });
    case "td_create_shared_task_comment":
      return createSharedTaskComment(args as { sharedOwnerId: string; ownerSecret: string; taskId: string; content: string; userId?: string });
    case "td_update_shared_task_comment":
      return updateSharedTaskComment(args as { sharedOwnerId: string; ownerSecret: string; id: string; content: string });
    case "td_delete_shared_task_comment":
      return deleteSharedTaskComment(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    case "td_create_shared_deployment_stage":
      return createSharedDeploymentStage(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        projectId: string;
        name: string;
        color?: string;
        position?: number;
      });
    case "td_list_shared_repository_links":
      return listSharedRepositoryLinks(args as {
        sharedOwnerId: string;
        ownerSecret: string;
      });
    case "td_create_shared_repository_link":
      return createSharedRepositoryLink(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        projectId: string;
        type?: string;
        url: string;
        label?: string;
      });
    case "td_update_shared_repository_link":
      return updateSharedRepositoryLink(args as { sharedOwnerId: string; ownerSecret: string; id: string; type?: string; url?: string; label?: string; position?: number });
    case "td_delete_shared_repository_link":
      return deleteSharedRepositoryLink(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    case "td_update_shared_deployment_stage":
      return updateSharedDeploymentStage(args as { sharedOwnerId: string; ownerSecret: string; id: string; name?: string; color?: string; position?: number });
    case "td_list_shared_tags":
      return listSharedTags(args as { sharedOwnerId: string; ownerSecret: string });
    case "td_create_shared_tag":
      return createSharedTag(args as { sharedOwnerId: string; ownerSecret: string; projectId: string; name: string; color?: string });
    case "td_update_shared_tag":
      return updateSharedTag(args as { sharedOwnerId: string; ownerSecret: string; id: string; name?: string; color?: string });
    case "td_delete_shared_tag":
      return deleteSharedTag(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    case "td_add_shared_tag_to_task":
      return addSharedTagToTask(args as { sharedOwnerId: string; ownerSecret: string; taskId: string; tagId: string });
    case "td_remove_shared_tag_from_task":
      return removeSharedTagFromTask(args as { sharedOwnerId: string; ownerSecret: string; taskId: string; tagId: string });
    case "td_delete_shared_deployment_stage":
      return deleteSharedDeploymentStage(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    case "td_update_shared_project":
      return updateSharedProject(args as { sharedOwnerId: string; ownerSecret: string; isArchived?: boolean; isHiddenFromFilters?: boolean });
    case "td_upload_shared_attachment":
      return uploadSharedAttachment(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        taskId: string;
        filePath?: string;
        content?: string;
        filename?: string;
        mimeType?: string;
      });
    case "td_list_shared_attachments":
      return listSharedAttachments(args as { sharedOwnerId: string; ownerSecret: string; taskId: string });
    case "td_download_shared_attachment":
      return downloadSharedAttachment(args as { sharedOwnerId: string; ownerSecret: string; id: string; savePath?: string });
    case "td_delete_shared_attachment":
      return deleteSharedAttachment(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    case "td_list_shared_members":
      return listSharedMembers(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        projectId?: string;
        includeKicked?: boolean;
      });
    case "td_update_shared_member":
      return updateSharedMember(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        id: string;
        permission?: string;
        isBlocked?: boolean;
        isKicked?: boolean;
      });
    case "td_upload_shared_note_attachment":
      return uploadSharedNoteAttachment(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        noteId: string;
        filePath?: string;
        content?: string;
        filename?: string;
        mimeType?: string;
      });
    case "td_list_shared_note_attachments":
      return listSharedNoteAttachments(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        noteId: string;
      });
    case "td_download_shared_note_attachment":
      return downloadSharedNoteAttachment(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        id: string;
        savePath?: string;
      });
    case "td_delete_shared_note_attachment":
      return deleteSharedNoteAttachment(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        id: string;
      });
    default:
      return undefined;
  }
}

async function listSharedProjects(
  evolu: EvoluInstance,
  args: { includeArchived?: boolean }
) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("projectRef")
      .select([
        "id",
        "projectId",
        "ownerSecret",
        "sharedOwnerId",
        "name",
        "code",
        "color",
        "isOwner",
        "permission",
        "joinedAt",
        "isArchived",
        "isHiddenFromFilters",
      ])
      .where("isDeleted", "is not", SQLITE_TRUE);

    if (!args.includeArchived) {
      q = q.where("isArchived", "is not", SQLITE_TRUE);
    }

    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    projects: result.map((p: any) => ({
      id: p.id,
      projectId: p.projectId,
      sharedOwnerId: p.sharedOwnerId,
      ownerSecret: p.ownerSecret,
      name: p.name,
      code: p.code,
      color: p.color,
      isOwner: p.isOwner === SQLITE_TRUE,
      permission: p.permission,
      joinedAt: p.joinedAt,
      isArchived: p.isArchived === SQLITE_TRUE,
    })),
  };
}

async function listSharedTasks(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    status?: string;
    limit?: number;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) => {
      let q = db
        .selectFrom("task")
        .leftJoin("project", "task.projectId", "project.id")
        .leftJoin("deploymentStage", "task.deploymentStageId", "deploymentStage.id")
        .select([
          "task.id",
          "task.ownerId as ownerId",
          "task.title",
          "task.name",
          "task.status",
          "task.priority",
          "task.deadline",
          "task.scheduledDate",
          "task.isBlocked",
          "task.estimate",
          "task.completedAt",
          "task.position",
          "task.isOnProduction",
          "task.deploymentStageId",
          "task.assigneeId",
          "project.id as projectId",
          "project.name as projectName",
          "project.code as projectCode",
          "project.color as projectColor",
          "deploymentStage.name as deploymentStageName",
          "deploymentStage.color as deploymentStageColor",
        ])
        .where("task.isDeleted", "is not", SQLITE_TRUE);

      if (args.status) {
        q = q.where("task.status", "=", args.status);
      }

      return q.orderBy("task.position", "asc").limit(args.limit || 50);
    });

    const result = await projectEvolu.loadQuery(query);

    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((t: any) => {
      const taskOwnerId = t.ownerId as string | undefined;
      return taskOwnerId === actualOwnerId;
    });

    return {
      count: filtered.length,
      sharedOwnerId: actualOwnerId,
      tasks: filtered.map((t: any) => ({
        id: t.id,
        code: t.title,
        name: t.name,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        scheduledDate: t.scheduledDate,
        isBlocked: t.isBlocked === SQLITE_TRUE,
        estimate: t.estimate,
        completedAt: t.completedAt,
        isOnProduction: t.isOnProduction === SQLITE_TRUE,
        assigneeId: t.assigneeId,
        deploymentStage: t.deploymentStageId
          ? {
              id: t.deploymentStageId,
              name: t.deploymentStageName,
              color: t.deploymentStageColor,
            }
          : null,
        project: t.projectId
          ? {
              id: t.projectId,
              name: t.projectName,
              code: t.projectCode,
              color: t.projectColor,
            }
          : null,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedDeploymentStages(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("deploymentStage")
        .leftJoin("project", "deploymentStage.projectId", "project.id")
        .select([
          "deploymentStage.id",
          "deploymentStage.ownerId as ownerId",
          "deploymentStage.name",
          "deploymentStage.color",
          "deploymentStage.position",
          "project.id as projectId",
          "project.name as projectName",
          "project.code as projectCode",
        ])
        .where("deploymentStage.isDeleted", "is not", SQLITE_TRUE)
        .orderBy("deploymentStage.position", "asc")
    );

    const result = await projectEvolu.loadQuery(query);

    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((s: any) => {
      const stageOwnerId = s.ownerId as string | undefined;
      return stageOwnerId === actualOwnerId;
    });

    return {
      count: filtered.length,
      stages: filtered.map((s: any) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        position: s.position,
        project: s.projectId
          ? {
              id: s.projectId,
              name: s.projectName,
              code: s.projectCode,
            }
          : null,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedTask(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    id: string;
    name?: string;
    description?: string;
    status?: string;
    priority?: string;
    deadline?: string | null;
    scheduledDate?: string | null;
    assigneeId?: string | null;
    estimate?: number;
    isBlocked?: boolean;
    blockedReason?: string;
    isOnProduction?: boolean;
    deploymentStageId?: string | null;
    recurrenceType?: string;
    recurrenceInterval?: number;
    recurrenceEndDate?: string | null;
    recurrenceDay?: string | null;
    sprintNumber?: number | null;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Clear, actionable errors before the opaque Evolu orThrow (TODO-181)
  assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "description");

  try {
    const updates: Record<string, unknown> = {
      id: args.id as TaskId,
    };

    if (args.name !== undefined) {
      updates.name = args.name ? NonEmptyString100.orThrow(args.name) : null;
    }
    if (args.description !== undefined) {
      updates.description = args.description ? NonEmptyString10000.orThrow(args.description) : null;
    }
    if (args.status !== undefined) {
      updates.status = args.status;
      if (args.status === "done") {
        updates.completedAt = new Date().toISOString();
      } else {
        updates.completedAt = null;
      }
    }
    if (args.priority !== undefined) {
      updates.priority = args.priority;
    }
    if (args.deadline !== undefined) {
      updates.deadline = args.deadline;
    }
    if (args.scheduledDate !== undefined) {
      updates.scheduledDate = args.scheduledDate;
    }
    if (args.assigneeId !== undefined) {
      updates.assigneeId = args.assigneeId ? (args.assigneeId as UserId) : null;
    }
    if (args.estimate !== undefined) {
      updates.estimate = args.estimate ? Int.orThrow(args.estimate) : null;
    }
    if (args.isBlocked !== undefined) {
      updates.isBlocked = args.isBlocked ? SQLITE_TRUE : null;
    }
    if (args.blockedReason !== undefined) {
      updates.blockedReason = args.blockedReason ? NonEmptyString1000.orThrow(args.blockedReason) : null;
    }
    if (args.isOnProduction !== undefined) {
      updates.isOnProduction = args.isOnProduction ? SQLITE_TRUE : null;
    }
    if (args.deploymentStageId !== undefined) {
      updates.deploymentStageId = args.deploymentStageId ? (args.deploymentStageId as DeploymentStageId) : null;
    }
    if (args.recurrenceType !== undefined) {
      updates.recurrenceType = args.recurrenceType || null;
    }
    if (args.recurrenceInterval !== undefined) {
      updates.recurrenceInterval = args.recurrenceInterval ? Int.orThrow(args.recurrenceInterval) : null;
    }
    if (args.recurrenceEndDate !== undefined) {
      updates.recurrenceEndDate = args.recurrenceEndDate || null;
    }
    if (args.recurrenceDay !== undefined) {
      updates.recurrenceDay = args.recurrenceDay || null;
    }
    if (args.sprintNumber !== undefined) {
      updates.sprintNumber = args.sprintNumber ? Int.orThrow(args.sprintNumber) : null;
    }

    const waiter = createMutationWaiter();
    const result = projectEvolu.update("task", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) {
      throw new Error(`Failed to update shared task: ${JSON.stringify(result.error)}`);
    }
    await waiter.waitForSync();

    return {
      success: true,
      message: "Shared task updated successfully",
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedTask(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    projectId: string;
    name?: string;
    description?: string;
    status?: string;
    priority?: string;
    deadline?: string;
    scheduledDate?: string;
    assigneeId?: string;
    estimate?: number;
    isOnProduction?: boolean;
    recurrenceType?: string;
    recurrenceInterval?: number;
    recurrenceEndDate?: string;
    recurrenceDay?: string;
    sprintNumber?: number;
    parentTaskId?: string;
    code?: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Clear, actionable error before the opaque Evolu orThrow (TODO-181)
  assertMaxLength(args.description, MAX_DESCRIPTION_LENGTH, "description");

  try {
    // Resolve the project (scoped to this shared owner) to derive the task code.
    const projectQuery = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("project")
        .select(["id", "code", "ownerId"])
        .where("id", "=", args.projectId as ProjectId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .limit(1)
    );
    const projects = (await projectEvolu.loadQuery(projectQuery)) as any[];
    const project = projects.find((p) => (p.ownerId as string) === (sharedOwner.id as string));
    if (!project) {
      throw new Error("Project not found in this shared project");
    }

    // Existing tasks of THIS owner (for code numbering + max position).
    // Exclude soft-deleted tasks so the code counter matches the app and does
    // not jump past tombstoned (e.g. deleted-duplicate) codes. (TODO-181)
    const tasksQuery = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("task")
        .select(["title", "position", "projectId", "ownerId", "status"])
        .where("isDeleted", "is not", SQLITE_TRUE)
    );
    const allTasks = ((await projectEvolu.loadQuery(tasksQuery)) as any[]).filter(
      (t) => (t.ownerId as string) === (sharedOwner.id as string)
    );
    const projectTasks = allTasks.filter((t) => (t.projectId as string) === (project.id as string));

    const projectCode = project.code || "TASK";
    let taskCode: string;
    if (args.code) {
      const codeRegex = new RegExp(`^${projectCode}-\\d+$`);
      if (!codeRegex.test(args.code)) {
        throw new Error(`Code "${args.code}" does not match project format "${projectCode}-NNN"`);
      }
      if (projectTasks.some((t) => t.title === args.code)) {
        throw new Error(`Code "${args.code}" is already used by another task`);
      }
      taskCode = args.code;
    } else {
      let maxNum = 0;
      const codeRegex = new RegExp(`^${projectCode}-(\\d+)$`);
      for (const t of projectTasks) {
        const match = (t.title as string | undefined)?.match(codeRegex);
        if (match) {
          const num = parseInt(match[1]!, 10);
          if (num > maxNum) maxNum = num;
        }
      }
      taskCode = `${projectCode}-${maxNum + 1}`;
    }

    // Lowest position in the TARGET column, so the new task lands on top like
    // it does in the app (TODO-217). Was the global max across every status.
    const targetStatus = args.status || "todo";
    const minPosition = allTasks.reduce(
      (m, t) => ((t.status as string) === targetStatus ? Math.min(m, (t.position as number) ?? 0) : m),
      0
    );

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert(
      "task",
      {
        projectId: args.projectId as ProjectId,
        title: NonEmptyString100.orThrow(taskCode),
        name: args.name ? NonEmptyString100.orThrow(args.name) : null,
        description: args.description ? NonEmptyString10000.orThrow(args.description) : null,
        status: args.status || "todo",
        priority: args.priority || "medium",
        deadline: args.deadline || null,
        scheduledDate: args.scheduledDate || null,
        assigneeId: args.assigneeId ? (args.assigneeId as UserId) : null,
        estimate: args.estimate ? Int.orThrow(args.estimate) : null,
        position: Int.orThrow(topPositionForNewTask(minPosition)),
        isOnProduction: args.isOnProduction ? SQLITE_TRUE : null,
        isBlocked: null,
        blockedReason: null,
        completedAt: null,
        recurrenceType: args.recurrenceType || null,
        recurrenceInterval: args.recurrenceInterval ? Int.orThrow(args.recurrenceInterval) : null,
        recurrenceEndDate: args.recurrenceEndDate || null,
        recurrenceDay: args.recurrenceDay || null,
        sprintNumber: args.sprintNumber ? Int.orThrow(args.sprintNumber) : null,
        ...(args.parentTaskId ? { parentTaskId: args.parentTaskId as TaskId } : {}),
      } as any,
      { ownerId: sharedOwner.id, onComplete: waiter.onComplete }
    );

    if (!result.ok) {
      throw new Error(`Failed to create shared task: ${JSON.stringify(result.error)}`);
    }

    // Touch with an update so Evolu sets updatedAt (only set on update, not insert).
    projectEvolu.update("task", { id: result.value.id, status: args.status || "todo" } as any, { ownerId: sharedOwner.id });

    await waiter.waitForSync();

    return {
      success: true,
      taskId: result.value.id,
      taskCode,
      message: `Shared task ${taskCode} created successfully`,
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedTask(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    id: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    // Cascade: soft-delete the task's checklist items (matches the app).
    const ciQuery = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("checklistItem")
        .select(["id", "ownerId"])
        .where("taskId", "=", args.id as TaskId)
        .where("isDeleted", "is not", SQLITE_TRUE)
    );
    const items = ((await projectEvolu.loadQuery(ciQuery)) as any[]).filter(
      (c) => (c.ownerId as string) === (sharedOwner.id as string)
    );
    for (const it of items) {
      projectEvolu.update("checklistItem", { id: it.id, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id });
    }

    // Cascade: soft-delete the task's comments (matches the app).
    const commentQuery = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("taskComment")
        .select(["id", "ownerId"])
        .where("taskId", "=", args.id as TaskId)
        .where("isDeleted", "is not", SQLITE_TRUE)
    );
    const comments = ((await projectEvolu.loadQuery(commentQuery)) as any[]).filter(
      (c) => (c.ownerId as string) === (sharedOwner.id as string)
    );
    for (const c of comments) {
      projectEvolu.update("taskComment", { id: c.id, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id });
    }

    const waiter = createMutationWaiter();
    const result = projectEvolu.update(
      "task",
      { id: args.id as TaskId, isDeleted: SQLITE_TRUE, deletedAt: new Date().toISOString() } as any,
      { ownerId: sharedOwner.id, onComplete: waiter.onComplete }
    );
    if (!result.ok) {
      throw new Error(`Failed to delete shared task: ${JSON.stringify(result.error)}`);
    }

    await waiter.waitForSync();

    return {
      success: true,
      message: `Shared task deleted successfully (cascaded ${items.length} checklist item(s), ${comments.length} comment(s))`,
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedWorklogs(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("worklog")
        .select(["id", "ownerId", "taskId", "userId", "durationMinutes", "description", "loggedAt"])
        .where("taskId", "=", args.taskId as TaskId)
        .where("isDeleted", "is not", SQLITE_TRUE)
    );
    const rows = ((await projectEvolu.loadQuery(query)) as any[]).filter(
      (w) => (w.ownerId as string) === (sharedOwner.id as string)
    );
    return {
      count: rows.length,
      worklogs: rows.map((w) => ({
        id: w.id,
        taskId: w.taskId,
        userId: w.userId,
        durationMinutes: w.durationMinutes,
        description: w.description,
        loggedAt: w.loggedAt,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function addSharedWorklog(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    taskId: string;
    durationMinutes: number;
    description?: string;
    loggedAt?: string;
    userId?: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    // Verify the task exists in this shared project (avoid orphan worklogs).
    const taskQuery = projectEvolu.createQuery((db: any) =>
      db.selectFrom("task").select(["id", "ownerId"]).where("id", "=", args.taskId as TaskId).where("isDeleted", "is not", SQLITE_TRUE).limit(1)
    );
    const tasks = ((await projectEvolu.loadQuery(taskQuery)) as any[]).filter((t) => (t.ownerId as string) === (sharedOwner.id as string));
    if (tasks.length === 0) throw new Error("Task not found in this shared project");

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert(
      "worklog",
      {
        taskId: args.taskId as TaskId,
        userId: args.userId ? (args.userId as UserId) : null,
        durationMinutes: Int.orThrow(args.durationMinutes),
        description: args.description ? NonEmptyString1000.orThrow(args.description) : null,
        loggedAt: args.loggedAt || new Date().toISOString().split("T")[0],
      },
      { ownerId: sharedOwner.id, onComplete: waiter.onComplete }
    );
    if (!result.ok) throw new Error(`Failed to add shared worklog: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, worklogId: result.value.id, message: "Shared worklog added successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedWorklog(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("worklog", { id: args.id as WorklogId, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to delete shared worklog: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared worklog deleted successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedChecklistItems(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("checklistItem")
        .select(["id", "ownerId", "taskId", "title", "isChecked", "position"])
        .where("taskId", "=", args.taskId as TaskId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .orderBy("position", "asc")
    );
    const rows = ((await projectEvolu.loadQuery(query)) as any[]).filter(
      (c) => (c.ownerId as string) === (sharedOwner.id as string)
    );
    return {
      count: rows.length,
      items: rows.map((c) => ({
        id: c.id,
        taskId: c.taskId,
        title: c.title,
        isChecked: c.isChecked === SQLITE_TRUE,
        position: c.position,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedChecklistItem(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string; title: string; position?: number }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    let position: number;
    if (args.position !== undefined) {
      position = args.position;
    } else {
      const posQuery = projectEvolu.createQuery((db: any) =>
        db.selectFrom("checklistItem").select(["position", "ownerId", "taskId"]).where("taskId", "=", args.taskId as TaskId).where("isDeleted", "is not", SQLITE_TRUE)
      );
      const existing = ((await projectEvolu.loadQuery(posQuery)) as any[]).filter((c) => (c.ownerId as string) === (sharedOwner.id as string));
      position = existing.reduce((m: number, c: any) => Math.max(m, (c.position as number) || 0), 0) + 1;
    }
    const waiter = createMutationWaiter();
    const result = projectEvolu.insert(
      "checklistItem",
      {
        taskId: args.taskId as TaskId,
        title: NonEmptyString1000.orThrow(args.title),
        isChecked: null,
        position: Int.orThrow(position),
      },
      { ownerId: sharedOwner.id, onComplete: waiter.onComplete }
    );
    if (!result.ok) throw new Error(`Failed to create shared checklist item: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, checklistItemId: result.value.id, message: "Shared checklist item created successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedChecklistItem(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; title?: string; isChecked?: boolean; position?: number }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const updates: Record<string, unknown> = { id: args.id as ChecklistItemId };
    if (args.title !== undefined) updates.title = NonEmptyString1000.orThrow(args.title);
    if (args.isChecked !== undefined) updates.isChecked = args.isChecked ? SQLITE_TRUE : null;
    if (args.position !== undefined) updates.position = Int.orThrow(args.position);

    const waiter = createMutationWaiter();
    const result = projectEvolu.update("checklistItem", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to update shared checklist item: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared checklist item updated successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedChecklistItem(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("checklistItem", { id: args.id as ChecklistItemId, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to delete shared checklist item: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared checklist item deleted successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedTaskComments(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("taskComment")
        .select(["id", "ownerId", "taskId", "userId", "content", "createdAt", "updatedAt"])
        .where("taskId", "=", args.taskId as TaskId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .orderBy("createdAt", "asc")
    );
    const rows = ((await projectEvolu.loadQuery(query)) as any[]).filter(
      (c) => (c.ownerId as string) === (sharedOwner.id as string)
    );
    return {
      count: rows.length,
      comments: rows.map((c) => ({
        id: c.id,
        taskId: c.taskId,
        userId: c.userId,
        content: c.content,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedTaskComment(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string; content: string; userId?: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.insert(
      "taskComment",
      {
        taskId: args.taskId as TaskId,
        userId: (args.userId ?? null) as UserId | null,
        content: EvoluString.orThrow(args.content),
      },
      { ownerId: sharedOwner.id, onComplete: waiter.onComplete }
    );
    if (!result.ok) throw new Error(`Failed to create shared comment: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, commentId: result.value.id, message: "Shared comment created successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedTaskComment(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; content: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update(
      "taskComment",
      { id: args.id as TaskCommentId, content: EvoluString.orThrow(args.content) } as any,
      { ownerId: sharedOwner.id, onComplete: waiter.onComplete }
    );
    if (!result.ok) throw new Error(`Failed to update shared comment: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared comment updated successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedTaskComment(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("taskComment", { id: args.id as TaskCommentId, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to delete shared comment: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared comment deleted successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedDeploymentStage(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    projectId: string;
    name: string;
    color?: string;
    position?: number;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("deploymentStage", {
      projectId: args.projectId as ProjectId,
      name: NonEmptyString100.orThrow(args.name),
      color: args.color || "#22c55e",
      position: Int.orThrow(args.position ?? 0),
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });

    if (!result.ok) {
      throw new Error(`Failed to create deployment stage: ${JSON.stringify(result.error)}`);
    }

    await waiter.waitForSync();

    return {
      success: true,
      stageId: result.value.id,
      message: `Deployment stage "${args.name}" created successfully`,
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedRepositoryLinks(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("repositoryLink")
        .leftJoin("project", "repositoryLink.projectId", "project.id")
        .select([
          "repositoryLink.id",
          "repositoryLink.ownerId as ownerId",
          "repositoryLink.type",
          "repositoryLink.url",
          "repositoryLink.label",
          "repositoryLink.position",
          "project.id as projectId",
          "project.name as projectName",
          "project.code as projectCode",
        ])
        .where("repositoryLink.isDeleted", "is not", SQLITE_TRUE)
        .orderBy("repositoryLink.position", "asc")
    );

    const result = await projectEvolu.loadQuery(query);

    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((l: any) => {
      const linkOwnerId = l.ownerId as string | undefined;
      return linkOwnerId === actualOwnerId;
    });

    return {
      count: filtered.length,
      links: filtered.map((l: any) => ({
        id: l.id,
        type: l.type,
        url: l.url,
        label: l.label,
        position: l.position,
        project: l.projectId
          ? {
              id: l.projectId,
              name: l.projectName,
              code: l.projectCode,
            }
          : null,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedRepositoryLink(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    projectId: string;
    type?: string;
    url: string;
    label?: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const posQuery = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("repositoryLink")
        .select(["position", "ownerId"])
        .where("isDeleted", "is not", SQLITE_TRUE)
        .orderBy("position", "desc")
    );
    const posResults = await projectEvolu.loadQuery(posQuery);
    const filteredPos = posResults.filter((r: any) => r.ownerId === (sharedOwner.id as string));
    const maxPosition = filteredPos.length > 0 ? ((filteredPos[0] as any).position || 0) : 0;

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("repositoryLink", {
      projectId: args.projectId as ProjectId,
      type: args.type || "github",
      url: NonEmptyString1000.orThrow(args.url),
      label: args.label ? NonEmptyString100.orThrow(args.label) : null,
      position: Int.orThrow(maxPosition + 1),
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });

    if (!result.ok) {
      throw new Error(`Failed to create repository link: ${JSON.stringify(result.error)}`);
    }

    await waiter.waitForSync();

    return {
      success: true,
      linkId: result.value.id,
      message: "Repository link created successfully",
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedRepositoryLink(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; type?: string; url?: string; label?: string; position?: number }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const updates: Record<string, unknown> = { id: args.id as RepositoryLinkId };
    if (args.type !== undefined) updates.type = args.type;
    if (args.url !== undefined) updates.url = NonEmptyString1000.orThrow(args.url);
    if (args.label !== undefined) updates.label = args.label ? NonEmptyString100.orThrow(args.label) : null;
    if (args.position !== undefined) updates.position = Int.orThrow(args.position);
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("repositoryLink", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to update shared repository link: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared repository link updated successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedRepositoryLink(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("repositoryLink", { id: args.id as RepositoryLinkId, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to delete shared repository link: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared repository link deleted successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedDeploymentStage(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; name?: string; color?: string; position?: number }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const updates: Record<string, unknown> = { id: args.id as DeploymentStageId };
    if (args.name !== undefined) updates.name = NonEmptyString100.orThrow(args.name);
    if (args.color !== undefined) updates.color = args.color;
    if (args.position !== undefined) updates.position = Int.orThrow(args.position);
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("deploymentStage", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to update shared deployment stage: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared deployment stage updated successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

// --- Project tags in shared projects (TODO-235) ---

async function listSharedTags(args: { sharedOwnerId: string; ownerSecret: string }) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("tag")
        .select(["id", "ownerId", "name", "color", "projectId"])
        .where("isDeleted", "is not", SQLITE_TRUE)
        .orderBy("name", "asc")
    );
    const result = await projectEvolu.loadQuery(query);
    // One Evolu instance holds every shared owner's rows, so filter by ownerId
    // or a caller sees other projects' tags.
    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((t: any) => (t.ownerId as string | undefined) === actualOwnerId);
    return {
      count: filtered.length,
      tags: filtered.map((t: any) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        projectId: t.projectId ?? null,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedTag(
  args: { sharedOwnerId: string; ownerSecret: string; projectId: string; name: string; color?: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("tag", {
      projectId: args.projectId as ProjectId,
      name: NonEmptyString100.orThrow(args.name),
      color: args.color || "#6b7280",
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to create shared tag: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, tagId: result.value.id, message: `Tag "${args.name}" created successfully` };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedTag(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; name?: string; color?: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const updates: Record<string, unknown> = { id: args.id as TagId };
    if (args.name !== undefined) updates.name = NonEmptyString100.orThrow(args.name);
    if (args.color !== undefined) updates.color = args.color;
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("tag", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to update shared tag: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared tag updated successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedTag(args: { sharedOwnerId: string; ownerSecret: string; id: string }) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("tag", { id: args.id as TagId, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to delete shared tag: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared tag deleted successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function addSharedTagToTask(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string; tagId: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    // Idempotent, like the app-instance tool: a second assignment must not add a
    // second taskTag row, or the tag shows twice and one removal leaves it there.
    const existingQuery = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("taskTag")
        .select(["id", "ownerId"])
        .where("taskId", "=", args.taskId as TaskId)
        .where("tagId", "=", args.tagId as TagId)
        .where("isDeleted", "is not", SQLITE_TRUE)
    );
    const existing = await projectEvolu.loadQuery(existingQuery);
    const actualOwnerId = sharedOwner.id as string;
    if (existing.some((r: any) => (r.ownerId as string | undefined) === actualOwnerId)) {
      return { success: true, message: "Tag is already assigned to this task" };
    }

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("taskTag", {
      taskId: args.taskId as TaskId,
      tagId: args.tagId as TagId,
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to assign shared tag: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, taskTagId: result.value.id, message: "Tag assigned successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function removeSharedTagFromTask(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string; tagId: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("taskTag")
        .select(["id", "ownerId"])
        .where("taskId", "=", args.taskId as TaskId)
        .where("tagId", "=", args.tagId as TagId)
        .where("isDeleted", "is not", SQLITE_TRUE)
    );
    const rows = await projectEvolu.loadQuery(query);
    const actualOwnerId = sharedOwner.id as string;
    const mine = rows.filter((r: any) => (r.ownerId as string | undefined) === actualOwnerId);
    if (mine.length === 0) {
      return { success: true, message: "Tag was not assigned to this task" };
    }

    // Every matching row, not just the first: a duplicate assignment would
    // otherwise survive an apparent removal.
    const waiter = createMutationWaiter();
    for (const row of mine) {
      const result = projectEvolu.update("taskTag", { id: row.id as TaskTagId, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
      if (!result.ok) throw new Error(`Failed to remove shared tag: ${JSON.stringify(result.error)}`);
    }
    await waiter.waitForSync();
    return { success: true, removed: mine.length, message: "Tag removed successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedDeploymentStage(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("deploymentStage", { id: args.id as DeploymentStageId, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to delete shared deployment stage: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared deployment stage deleted successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedProject(
  args: { sharedOwnerId: string; ownerSecret: string; isArchived?: boolean; isHiddenFromFilters?: boolean }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const projectQuery = projectEvolu.createQuery((db: any) =>
      db.selectFrom("project").select(["id", "ownerId"]).where("isDeleted", "is not", SQLITE_TRUE)
    );
    const projects = ((await projectEvolu.loadQuery(projectQuery)) as any[]).filter(
      (p) => (p.ownerId as string) === (sharedOwner.id as string)
    );
    if (projects.length === 0) throw new Error("Project not found for this shared owner");

    const updates: Record<string, unknown> = { id: projects[0].id };
    if (args.isArchived !== undefined) updates.isArchived = args.isArchived ? SQLITE_TRUE : null;
    if (args.isHiddenFromFilters !== undefined) updates.isHiddenFromFilters = args.isHiddenFromFilters ? SQLITE_TRUE : null;

    const waiter = createMutationWaiter();
    const result = projectEvolu.update("project", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to update shared project: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared project updated successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedMembers(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    projectId?: string;
    includeKicked?: boolean;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) => {
      let q = db
        .selectFrom("projectMember")
        .select([
          "id",
          "ownerId",
          "projectId",
          "userAppOwnerId",
          "userName",
          "userColor",
          "userAvatarUrl",
          "permission",
          "joinedAt",
          "isKicked",
          "isBlocked",
        ])
        .where("isDeleted", "is not", SQLITE_TRUE);

      if (args.projectId) {
        q = q.where("projectId", "=", args.projectId as ProjectId);
      }
      if (!args.includeKicked) {
        q = q.where("isKicked", "is not", SQLITE_TRUE);
      }

      return q.orderBy("joinedAt", "asc");
    });

    const result = await projectEvolu.loadQuery(query);

    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((m: any) => (m.ownerId as string | undefined) === actualOwnerId);

    return {
      count: filtered.length,
      sharedOwnerId: actualOwnerId,
      members: filtered.map((m: any) => ({
        id: m.id,
        projectId: m.projectId,
        userAppOwnerId: m.userAppOwnerId,
        userName: m.userName,
        userColor: m.userColor,
        userAvatarUrl: m.userAvatarUrl,
        permission: m.permission,
        joinedAt: m.joinedAt,
        isKicked: m.isKicked === SQLITE_TRUE,
        isBlocked: m.isBlocked === SQLITE_TRUE,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedMember(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    id: string;
    permission?: string;
    isBlocked?: boolean;
    isKicked?: boolean;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const updates: Record<string, unknown> = {
      id: args.id as ProjectMemberId,
    };

    if (args.permission !== undefined) {
      updates.permission = args.permission;
    }
    if (args.isBlocked !== undefined) {
      updates.isBlocked = args.isBlocked ? SQLITE_TRUE : null;
    }
    if (args.isKicked !== undefined) {
      updates.isKicked = args.isKicked ? SQLITE_TRUE : null;
    }

    const waiter = createMutationWaiter();
    const result = projectEvolu.update("projectMember", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) {
      throw new Error(`Failed to update shared member: ${JSON.stringify(result.error)}`);
    }
    await waiter.waitForSync();

    return {
      success: true,
      message: "Shared project member updated successfully",
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function uploadSharedNoteAttachment(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    noteId: string;
    filePath?: string;
    content?: string;
    filename?: string;
    mimeType?: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }
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

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("noteAttachment", {
      noteId: args.noteId as ProjectNoteId,
      filename: NonEmptyString100.orThrow(filename),
      mimeType,
      data: fileContent,
      size: Int.orThrow(size),
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });

    if (!result.ok) {
      throw new Error(`Failed to upload shared note attachment: ${JSON.stringify(result.error)}`);
    }

    await waiter.waitForSync();

    return {
      success: true,
      attachmentId: result.value.id,
      filename,
      mimeType,
      size,
      message: `Attachment "${filename}" uploaded to shared note successfully`,
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedNoteAttachments(
  args: { sharedOwnerId: string; ownerSecret: string; noteId: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("noteAttachment")
        .select(["id", "ownerId", "noteId", "filename", "mimeType", "size"])
        .where("noteId", "=", args.noteId as ProjectNoteId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .where("data", "is not", null)
    );

    const result = await projectEvolu.loadQuery(query);
    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((a: any) => (a.ownerId as string | undefined) === actualOwnerId);

    return {
      count: filtered.length,
      attachments: filtered.map((a: any) => ({
        id: a.id,
        noteId: a.noteId,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function downloadSharedNoteAttachment(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; savePath?: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("noteAttachment")
        .select(["id", "filename", "mimeType", "data", "size"])
        .where("id", "=", args.id as NoteAttachmentId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .limit(1)
    );

    const result = await projectEvolu.loadQuery(query);
    if (result.length === 0) {
      return { error: "Shared note attachment not found" };
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
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedNoteAttachment(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const waiter = createMutationWaiter();
    projectEvolu.update("noteAttachment", {
      id: args.id as NoteAttachmentId,
      data: null,
      isDeleted: SQLITE_TRUE,
    } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    await waiter.waitForSync();

    return {
      success: true,
      message: "Shared note attachment deleted successfully",
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function uploadSharedAttachment(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    taskId: string;
    filePath?: string;
    content?: string;
    filename?: string;
    mimeType?: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  if (!args.filePath && !args.content) throw new Error("Either filePath or content is required");
  if (args.filePath && args.content) throw new Error("Provide either filePath or content, not both");

  let fileContent: string;
  let filename: string;
  let mimeType: string;
  let size: number;

  if (args.filePath) {
    if (!existsSync(args.filePath)) throw new Error(`File not found: ${args.filePath}`);
    const fileBuffer = readFileSync(args.filePath);
    fileContent = fileBuffer.toString("base64");
    size = fileBuffer.length;
    filename = args.filename || basename(args.filePath);
    mimeType = args.mimeType || lookup(filename) || "application/octet-stream";
  } else {
    if (!args.filename) throw new Error("filename is required when using content parameter");
    fileContent = args.content!;
    filename = args.filename;
    mimeType = args.mimeType || lookup(filename) || "application/octet-stream";
    size = Math.ceil((fileContent.length * 3) / 4);
  }

  if (filename.length > 100) throw new Error("Filename must be 100 characters or less");
  assertAttachmentSize(fileContent);

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    // Verify the task exists in this shared project.
    const taskQuery = projectEvolu.createQuery((db: any) =>
      db.selectFrom("task").select(["id", "ownerId"]).where("id", "=", args.taskId as TaskId).where("isDeleted", "is not", SQLITE_TRUE).limit(1)
    );
    const tasks = ((await projectEvolu.loadQuery(taskQuery)) as any[]).filter((t) => (t.ownerId as string) === (sharedOwner.id as string));
    if (tasks.length === 0) throw new Error("Task not found in this shared project");

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("attachment", {
      taskId: args.taskId as TaskId,
      filename: NonEmptyString100.orThrow(filename),
      mimeType,
      data: fileContent,
      size: Int.orThrow(size),
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });

    if (!result.ok) throw new Error(`Failed to upload shared attachment: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();

    return { success: true, attachmentId: result.value.id, filename, mimeType, size, message: `Attachment "${filename}" uploaded to shared task successfully` };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedAttachments(
  args: { sharedOwnerId: string; ownerSecret: string; taskId: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("attachment")
        .select(["id", "ownerId", "taskId", "filename", "mimeType", "size"])
        .where("taskId", "=", args.taskId as TaskId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .where("data", "is not", null)
    );
    const rows = ((await projectEvolu.loadQuery(query)) as any[]).filter((a) => (a.ownerId as string) === (sharedOwner.id as string));
    return {
      count: rows.length,
      attachments: rows.map((a) => ({ id: a.id, taskId: a.taskId, filename: a.filename, mimeType: a.mimeType, size: a.size })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function downloadSharedAttachment(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; savePath?: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("attachment")
        .select(["id", "filename", "mimeType", "data", "size"])
        .where("id", "=", args.id as AttachmentId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .limit(1)
    );
    const result = await projectEvolu.loadQuery(query);
    if (result.length === 0) return { error: "Shared attachment not found" };
    const a = result[0] as any;
    if (!a.data) return { error: "Attachment data is empty (may have been deleted)" };

    if (args.savePath) {
      const target = resolveDownloadPath(args.savePath);
      const dir = dirname(target);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(target, Buffer.from(a.data, "base64"));
      return { success: true, filePath: target, filename: a.filename, mimeType: a.mimeType, size: a.size };
    }
    return { id: a.id, filename: a.filename, mimeType: a.mimeType, data: a.data, size: a.size };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function deleteSharedAttachment(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) throw new Error("Project Evolu not initialized");
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.update("attachment", { id: args.id as AttachmentId, data: null, isDeleted: SQLITE_TRUE } as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    if (!result.ok) throw new Error(`Failed to delete shared attachment: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();
    return { success: true, message: "Shared attachment deleted successfully" };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}
