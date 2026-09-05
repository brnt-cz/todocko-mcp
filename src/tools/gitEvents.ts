import { relayHttpBase } from "./pure.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";


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
  // Was the only one of the three that used the variable raw, so it kept the
  // container port as well as a wss:// scheme. (TODO-288)
  const relayUrl = relayHttpBase(process.env.TODOCKO_RELAY_URL);
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
