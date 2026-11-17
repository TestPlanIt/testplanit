import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnvConfig } from "./env.js";
import type { WhoamiUser } from "./http.js";
import { registerAll } from "./tools/index.js";

/**
 * Dependencies the CLI bootstrap (cli.ts `runServer`) injects into
 * `createServer`.
 *
 * `user` is the `WhoamiUser` resolved by the bootstrap probe; it is
 * intentionally retained on the deps contract even though the
 * production tools (`whoami`) re-fetch live data on every call. Future
 * tools may use `user` for static-shape decisions (e.g., gating
 * write tools on `!user.readOnly` at registration time).
 */
export interface ServerDeps {
  env: EnvConfig;
  user: WhoamiUser;
}

/**
 * Create an MCP server instance for TestPlanIt.
 *
 * The production `whoami` tool is registered through the central
 * `registerAll` registry — new tools plug into the registry without
 * further edits to this file.
 */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({
    name: "@testplanit/mcp-server",
    version: "0.0.0",
  });
  registerAll(server, { env: deps.env });
  return server;
}
