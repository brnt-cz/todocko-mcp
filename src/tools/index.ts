import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { EvoluInstance } from "../evolu.js";

// Feature modules
import { projectTools, handleProjectTool } from "./projects.js";
import { taskTools, handleTaskTool } from "./tasks.js";
import { userTools, handleUserTool } from "./users.js";
import { worklogTools, handleWorklogTool } from "./worklogs.js";
import { attachmentTools, handleAttachmentTool } from "./attachments.js";
import { noteAttachmentTools, handleNoteAttachmentTool } from "./noteAttachments.js";
import { deploymentStageTools, handleDeploymentStageTool } from "./deploymentStages.js";
import { repositoryLinkTools, handleRepositoryLinkTool } from "./repositoryLinks.js";
import { sharedTools, handleSharedTool } from "./shared.js";
import { diagnosticTools, handleDiagnosticTool } from "./diagnostics.js";
import { taskCommentTools, handleTaskCommentTool } from "./taskComments.js";
import { checklistItemTools, handleChecklistItemTool } from "./checklistItems.js";
import { mentionTools, handleMentionTool } from "./mentions.js";
import { taskLinkTools, handleTaskLinkTool } from "./taskLinks.js";
import { tagTools, handleTagTool } from "./tags.js";
import { taskTemplateTools, handleTaskTemplateTool } from "./taskTemplates.js";
import { kanbanColumnTools, handleKanbanColumnTool } from "./kanbanColumns.js";
import { savedViewTools, handleSavedViewTool } from "./savedViews.js";
import { activityLogTools, handleActivityLogTool } from "./activityLog.js";
import { projectNoteTools, handleProjectNoteTool } from "./projectNotes.js";
import { projectDocTools, handleProjectDocTool } from "./projectDocs.js";
import { systemNotificationTools, handleSystemNotificationTool } from "./systemNotifications.js";
import { analyticsTools, handleAnalyticsTool } from "./analytics.js";
import { gitEventTools, handleGitEventTool } from "./gitEvents.js";

// Aggregated tool definitions
export const tools: Tool[] = [
  ...projectTools,
  ...taskTools,
  ...userTools,
  ...worklogTools,
  ...attachmentTools,
  ...noteAttachmentTools,
  ...deploymentStageTools,
  ...repositoryLinkTools,
  ...taskCommentTools,
  ...checklistItemTools,
  ...mentionTools,
  ...taskLinkTools,
  ...tagTools,
  ...taskTemplateTools,
  ...kanbanColumnTools,
  ...savedViewTools,
  ...activityLogTools,
  ...projectNoteTools,
  ...projectDocTools,
  ...sharedTools,
  ...systemNotificationTools,
  ...analyticsTools,
  ...gitEventTools,
  ...diagnosticTools,
];

// Handlers in priority order (most common first)
const handlers: Array<(name: string, args: Record<string, unknown>, evolu: EvoluInstance) => Promise<unknown>> = [
  handleTaskTool,
  handleProjectTool,
  handleUserTool,
  handleWorklogTool,
  handleAttachmentTool,
  handleNoteAttachmentTool,
  handleDeploymentStageTool,
  handleRepositoryLinkTool,
  handleTaskCommentTool,
  handleChecklistItemTool,
  handleMentionTool,
  handleTaskLinkTool,
  handleTagTool,
  handleTaskTemplateTool,
  handleKanbanColumnTool,
  handleSavedViewTool,
  handleActivityLogTool,
  handleProjectNoteTool,
  handleProjectDocTool,
  handleSharedTool,
  handleSystemNotificationTool,
  handleAnalyticsTool,
  (name, args, _evolu) => handleGitEventTool(name, args),
  (name, args, _evolu) => handleDiagnosticTool(name, args),
];

// Tool handler — routes to the correct module
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  for (const handler of handlers) {
    const result = await handler(name, args, evolu);
    if (result !== undefined) return result;
  }
  throw new Error(`Unknown tool: ${name}`);
}
