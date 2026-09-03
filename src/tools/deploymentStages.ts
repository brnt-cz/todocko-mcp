import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, Int } from "@evolu/common";
import { SQLITE_TRUE, type ProjectId, type DeploymentStageId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter } from "./helpers.js";

export const deploymentStageTools: Tool[] = [
  {
    name: "td_list_deployment_stages",
    description: "List deployment stages for a project. Returns stage id, name, color, and position.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project ID to get stages for (optional - returns all if not specified)",
        },
      },
    },
  },
  {
    name: "td_create_deployment_stage",
    description: "Create a deployment stage for a personal project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID (required)" },
        name: { type: "string", description: "Stage name, e.g. 'Test', 'Stage', 'Prod' (required)" },
        color: { type: "string", description: "Hex color for the badge (default: #22c55e)" },
        position: { type: "number", description: "Order position (default: appended to the end)" },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "td_update_deployment_stage",
    description: "Update a deployment stage in a personal project.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Deployment stage ID (required)" },
        name: { type: "string", description: "Stage name" },
        color: { type: "string", description: "Hex color for the badge" },
        position: { type: "number", description: "Order position" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_deployment_stage",
    description: "Soft-delete a deployment stage in a personal project.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Deployment stage ID (required)" },
      },
      required: ["id"],
    },
  },
];

export async function handleDeploymentStageTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_deployment_stages":
      return listDeploymentStages(evolu, args as { projectId?: string });
    case "td_create_deployment_stage":
      return createDeploymentStage(evolu, args as { projectId: string; name: string; color?: string; position?: number });
    case "td_update_deployment_stage":
      return updateDeploymentStage(evolu, args as { id: string; name?: string; color?: string; position?: number });
    case "td_delete_deployment_stage":
      return deleteDeploymentStage(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function createDeploymentStage(
  evolu: EvoluInstance,
  args: { projectId: string; name: string; color?: string; position?: number }
) {
  let position = args.position;
  if (position === undefined) {
    const posQuery = evolu.createQuery((db: any) =>
      db.selectFrom("deploymentStage").select(["position"]).where("projectId", "=", args.projectId as ProjectId).where("isDeleted", "is not", SQLITE_TRUE)
    );
    const existing = (await evolu.loadQuery(posQuery)) as any[];
    position = existing.reduce((m: number, s: any) => Math.max(m, (s.position as number) || 0), 0) + 1;
  }
  const waiter = createMutationWaiter();
  const result = evolu.insert("deploymentStage", {
    projectId: args.projectId as ProjectId,
    name: NonEmptyTrimmedString100.orThrow(args.name),
    color: args.color || "#22c55e",
    position: Int.orThrow(position),
  } as any, { onComplete: waiter.onComplete });
  if (!result.ok) throw new Error(`Failed to create deployment stage: ${JSON.stringify(result.error)}`);
  await waiter.waitForSync();
  return { success: true, stageId: result.value.id, message: `Deployment stage "${args.name}" created successfully` };
}

async function updateDeploymentStage(
  evolu: EvoluInstance,
  args: { id: string; name?: string; color?: string; position?: number }
) {
  const updates: Record<string, unknown> = { id: args.id as DeploymentStageId };
  if (args.name !== undefined) updates.name = NonEmptyTrimmedString100.orThrow(args.name);
  if (args.color !== undefined) updates.color = args.color;
  if (args.position !== undefined) updates.position = Int.orThrow(args.position);
  const waiter = createMutationWaiter();
  const result = evolu.update("deploymentStage", updates as any, { onComplete: waiter.onComplete });
  if (!result.ok) throw new Error(`Failed to update deployment stage: ${JSON.stringify(result.error)}`);
  await waiter.waitForSync();
  return { success: true, message: "Deployment stage updated successfully" };
}

async function deleteDeploymentStage(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  const result = evolu.update("deploymentStage", { id: args.id as DeploymentStageId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete });
  if (!result.ok) throw new Error(`Failed to delete deployment stage: ${JSON.stringify(result.error)}`);
  await waiter.waitForSync();
  return { success: true, message: "Deployment stage deleted successfully" };
}

async function listDeploymentStages(
  evolu: EvoluInstance,
  args: { projectId?: string }
) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("deploymentStage")
      .leftJoin("project", "deploymentStage.projectId", "project.id")
      .select([
        "deploymentStage.id",
        "deploymentStage.name",
        "deploymentStage.color",
        "deploymentStage.position",
        "project.id as projectId",
        "project.name as projectName",
        "project.code as projectCode",
      ])
      .where("deploymentStage.isDeleted", "is not", SQLITE_TRUE)
      .orderBy("deploymentStage.position", "asc");

    if (args.projectId) {
      q = q.where("deploymentStage.projectId", "=", args.projectId as ProjectId);
    }

    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    stages: result.map((s: any) => ({
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
}
