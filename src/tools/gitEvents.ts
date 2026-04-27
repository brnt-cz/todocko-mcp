import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_RELAY_URL = "https://relay.todocko.cz";

export const gitEventTools: Tool[] = [
  {
    name: "td_list_git_events",
    description: "List git events (push, PR opened/merged/closed) for a task by its code. Fetches from the Todocko relay server.",
    inputSchema: {
      type: "object",
      properties: {
        taskCode: {
          type: "string",
          description: "Task code (e.g., 'TODO-146') (required)",
        },
      },
      required: ["taskCode"],
    },
  },
];

export async function handleGitEventTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "td_list_git_events":
      return listGitEvents(args as { taskCode: string });
    default:
      return undefined;
  }
}

async function listGitEvents(args: { taskCode: string }) {
  const relayUrl = process.env.TODOCKO_RELAY_URL || DEFAULT_RELAY_URL;
  const url = `${relayUrl}/api/git-events/${encodeURIComponent(args.taskCode)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch git events: ${response.status} ${response.statusText}`);
  }

  const events = await response.json();

  return {
    taskCode: args.taskCode,
    count: Array.isArray(events) ? events.length : 0,
    events: events,
  };
}
