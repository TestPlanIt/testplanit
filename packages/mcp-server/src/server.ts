import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { EnvConfig } from "./env.js";
import type { WhoamiUser } from "./http.js";

export interface ServerDeps {
  env: EnvConfig;
  user: WhoamiUser;
}

/**
 * Create an MCP server instance for TestPlanIt.
 *
 * Plan 05-06 registers the smoke `__server_info` tool so the InMemoryTransport
 * handshake test can verify `client.listTools()` returns a non-empty array.
 * Plan 05-07 adds the production `whoami` tool alongside it (or replaces
 * `__server_info` if it's deemed unnecessary post-whoami).
 */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({
    name: "@testplanit/mcp-server",
    version: "0.0.0",
  });

  // Smoke tool — proves handshake + registerTool wiring works end-to-end.
  // Returns deterministic metadata about this server instance. The token
  // prefix exposed here is the safe `tpi_xxxx` 8-char form (T-05-06).
  server.registerTool(
    "__server_info",
    {
      description:
        "Internal: returns package metadata. Used for health checks.",
      // RAW zod shape (NOT z.object({})) — Pitfall 4 from 05-RESEARCH.
      inputSchema: {},
      outputSchema: {
        packageName: z.string(),
        packageVersion: z.string(),
        tokenPrefix: z.string(),
        userEmail: z.string().email(),
      },
    },
    async () => {
      const result = {
        packageName: "@testplanit/mcp-server",
        packageVersion: "0.0.0",
        tokenPrefix: deps.env.apiToken.slice(0, 8), // safe — prefix only.
        userEmail: deps.user.email,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}
