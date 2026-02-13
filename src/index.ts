#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { join } from "path";
import { initEvolu, getEvolu, initProjectEvolu, waitForEvolu } from "./evolu.js";
import { tools, handleToolCall } from "./tools/index.js";

// Set working directory to ~/.todocko for database storage (cross-platform)
const todockoDir = join(homedir(), ".todocko");
mkdirSync(todockoDir, { recursive: true });
process.chdir(todockoDir);

const server = new Server(
  {
    name: "todocko-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls - waits for Evolu to be ready before processing
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Wait for Evolu initialization and sync to complete
    await waitForEvolu();

    const evolu = getEvolu();
    if (!evolu) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Evolu not initialized. Please set TODOCKO_MNEMONIC environment variable.",
          },
        ],
        isError: true,
      };
    }

    const result = await handleToolCall(name, args || {}, evolu);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  // Check for mnemonic
  const mnemonic = process.env.TODOCKO_MNEMONIC;
  if (!mnemonic) {
    console.error("Error: TODOCKO_MNEMONIC environment variable is required.");
    console.error("Set it to your 24-word Evolu backup phrase.");
    process.exit(1);
  }

  // Connect MCP transport FIRST so the client gets a response immediately
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Todocko MCP Server running on stdio");

  // Initialize Evolu in the background - tool calls will await waitForEvolu()
  try {
    await initEvolu(mnemonic);
    console.error("Evolu instance created, sync running in background.");

    await initProjectEvolu();
    console.error("Project Evolu created for shared projects.");
  } catch (error) {
    console.error("Failed to initialize Evolu:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});