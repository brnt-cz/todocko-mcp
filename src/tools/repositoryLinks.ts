import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, NonEmptyTrimmedString1000, Int } from "@evolu/common";
import { SQLITE_TRUE, type ProjectId, type RepositoryLinkId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter , assertMutation} from "./helpers.js";

export const repositoryLinkTools: Tool[] = [
  {
    name: "td_list_repository_links",
    description: "List repository links for a project. Returns link id, type, url, label, and position.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project ID to get links for (optional - returns all if not specified)",
        },
      },
    },
  },
  {
    name: "td_create_repository_link",
    description: "Create a repository link for a project",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project ID (required)",
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
      required: ["projectId", "url"],
    },
  },
  {
    name: "td_update_repository_link",
    description: "Update a repository link for a project.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Repository link ID (required)" },
        type: { type: "string", enum: ["github", "gitlab", "bitbucket", "azure", "custom"], description: "Repository type" },
        url: { type: "string", description: "Repository URL" },
        label: { type: "string", description: "Label, or empty string to clear" },
        position: { type: "number", description: "Order position" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_repository_link",
    description: "Delete a repository link",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Repository link ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleRepositoryLinkTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_repository_links":
      return listRepositoryLinks(evolu, args as { projectId?: string });
    case "td_create_repository_link":
      return createRepositoryLink(evolu, args as {
        projectId: string;
        type?: string;
        url: string;
        label?: string;
      });
    case "td_update_repository_link":
      return updateRepositoryLink(evolu, args as { id: string; type?: string; url?: string; label?: string; position?: number });
    case "td_delete_repository_link":
      return deleteRepositoryLink(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listRepositoryLinks(
  evolu: EvoluInstance,
  args: { projectId?: string }
) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("repositoryLink")
      .leftJoin("project", "repositoryLink.projectId", "project.id")
      .select([
        "repositoryLink.id",
        "repositoryLink.type",
        "repositoryLink.url",
        "repositoryLink.label",
        "repositoryLink.position",
        "project.id as projectId",
        "project.name as projectName",
        "project.code as projectCode",
      ])
      .where("repositoryLink.isDeleted", "is not", SQLITE_TRUE)
      .orderBy("repositoryLink.position", "asc");

    if (args.projectId) {
      q = q.where("repositoryLink.projectId", "=", args.projectId as ProjectId);
    }

    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    links: result.map((l: any) => ({
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
}

async function createRepositoryLink(
  evolu: EvoluInstance,
  args: {
    projectId: string;
    type?: string;
    url: string;
    label?: string;
  }
) {
  const posQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("repositoryLink")
      .select(["position"])
      .where("projectId", "=", args.projectId as ProjectId)
      .orderBy("position", "desc")
      .limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPosition = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("repositoryLink", {
    projectId: args.projectId as ProjectId,
    type: args.type || "github",
    url: NonEmptyTrimmedString1000.orThrow(args.url),
    label: args.label ? NonEmptyTrimmedString100.orThrow(args.label) : null,
    position: Int.orThrow(maxPosition + 1),
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    linkId: result.id,
    message: "Repository link created successfully",
  };
}

async function updateRepositoryLink(
  evolu: EvoluInstance,
  args: { id: string; type?: string; url?: string; label?: string; position?: number }
) {
  const updates: Record<string, unknown> = { id: args.id as RepositoryLinkId };
  if (args.type !== undefined) updates.type = args.type;
  if (args.url !== undefined) updates.url = NonEmptyTrimmedString1000.orThrow(args.url);
  if (args.label !== undefined) updates.label = args.label ? NonEmptyTrimmedString100.orThrow(args.label) : null;
  if (args.position !== undefined) updates.position = Int.orThrow(args.position);

  const waiter = createMutationWaiter();
  const result = evolu.update("repositoryLink", updates as any, { onComplete: waiter.onComplete });
  await waiter.waitForSync();
  return { success: true, message: "Repository link updated successfully" };
}

async function deleteRepositoryLink(
  evolu: EvoluInstance,
  args: { id: string }
) {
  const waiter = createMutationWaiter();
  assertMutation("deleteRepositoryLink",
    evolu.update("repositoryLink", {
      id: args.id as RepositoryLinkId,
      isDeleted: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Repository link deleted successfully",
  };
}
