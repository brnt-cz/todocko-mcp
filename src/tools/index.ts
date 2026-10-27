import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { EvoluInstance } from "../evolu.js";
import { assertRequiredArgs, assertArgTypes } from "./pure.js";

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
import { appSettingTools, handleAppSettingTool } from "./appSettings.js";
import { activityLogTools, handleActivityLogTool } from "./activityLog.js";
import { projectNoteTools, handleProjectNoteTool } from "./projectNotes.js";
import { projectDocTools, handleProjectDocTool } from "./projectDocs.js";
import { systemNotificationTools, adminOnlySystemNotificationTools, handleSystemNotificationTool } from "./systemNotifications.js";
import { userMessageTools, handleUserMessageTool } from "./userMessages.js";
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
  ...appSettingTools,
  ...activityLogTools,
  ...projectNoteTools,
  ...projectDocTools,
  ...sharedTools,
  ...systemNotificationTools,
  ...userMessageTools,
  ...analyticsTools,
  ...gitEventTools,
  ...diagnosticTools,
];

/**
 * Every tool this server knows, whether or not this installation registers it.
 *
 * `tools` is what the client is offered and now depends on the environment: the
 * two admin notification tools are left out without TODOCKO_RELAY_ADMIN_KEY
 * (TODO-441). Documentation and the catalogue tests describe the server, not one
 * machine's configuration, so they read this instead.
 */
export const allTools: Tool[] = [
  ...tools,
  ...adminOnlySystemNotificationTools.filter((t) => !tools.some((x) => x.name === t.name)),
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
  handleAppSettingTool,
  handleActivityLogTool,
  handleProjectNoteTool,
  handleProjectDocTool,
  handleSharedTool,
  handleSystemNotificationTool,
  (name, args, _evolu) => handleUserMessageTool(name, args),
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
  // One choke point for every tool: the schemas already declare what is
  // required, and until now nothing checked it. See assertRequiredArgs for what
  // a missing id actually did. (TODO-292)
  const schema = tools.find((t) => t.name === name)?.inputSchema;
  assertRequiredArgs(name, args, schema as { required?: string[]; properties?: Record<string, unknown> } | undefined);
  // The same choke point for the values themselves: the declared types and the
  // date formats were never checked, so `isBlocked: "false"` was stored as true
  // and `deadline: "zitra"` went into the column as written. (TODO-441)
  assertArgTypes(name, args, schema as { properties?: Record<string, unknown> } | undefined);

  for (const handler of handlers) {
    const result = await handler(name, args, evolu);
    if (result !== undefined) return result;
  }
  throw new Error(`Unknown tool: ${name}`);
}
