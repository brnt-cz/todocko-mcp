#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { initEvolu, getEvolu } from "./evolu.js";
import { tools, handleToolCall } from "./tools/index.js";

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

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
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

  // Initialize Evolu with mnemonic
  try {
    await initEvolu(mnemonic);
    console.error("Todocko MCP Server initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize Evolu:", error);
    process.exit(1);
  }

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Todocko MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
