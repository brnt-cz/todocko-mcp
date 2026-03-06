import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SQLITE_TRUE, type ProjectId, type EvoluInstance } from "../evolu.js";

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
];

export async function handleDeploymentStageTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_deployment_stages":
      return listDeploymentStages(evolu, args as { projectId?: string });
    default:
      return undefined;
  }
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
