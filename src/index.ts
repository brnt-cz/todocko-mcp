#!/usr/bin/env node

// CRITICAL: Redirect all console output to stderr BEFORE any imports.
// StdioServerTransport uses stdout for JSON-RPC — any console.log() from
// Evolu (enableLogging) or other libs would corrupt the protocol and cause
// "Connection closed" errors.
const _origLog = console.log;
const _origInfo = console.info;
const _origWarn = console.warn;
const _origDebug = console.debug;
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.warn = (...args: unknown[]) => console.error(...args);
console.debug = (...args: unknown[]) => console.error(...args);

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
    return {
      content: [
        {
          type: "text",
          text: `Error: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Format an error for the MCP response, unwrapping the `cause` chain.
 *
 * Evolu's `Type.orThrow()` throws `new Error("getOrThrow", { cause })` where the
 * actual reason (e.g. a String1000 maxLength validation failure) lives in
 * `cause`. Surfacing only `error.message` produced an opaque "getOrThrow" with
 * no diagnostic value, so we append the cause chain here.
 */
function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  let message = error.message;
  let cause: unknown = (error as { cause?: unknown }).cause;
  const seen = new Set<unknown>([error]);

  while (cause != null && !seen.has(cause)) {
    seen.add(cause);
    if (cause instanceof Error) {
      message += ` (cause: ${cause.message})`;
      cause = (cause as { cause?: unknown }).cause;
    } else {
      const text = typeof cause === "string" ? cause : JSON.stringify(cause);
      message += ` (cause: ${text})`;
      break;
    }
  }

  return message;
}

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

// Prevent silent crashes — log to stderr and keep running if possible
process.on("uncaughtException", (error) => {
  console.error("[todocko-mcp] Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[todocko-mcp] Unhandled rejection:", reason);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});