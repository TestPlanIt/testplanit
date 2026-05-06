import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoami, type WhoamiDeps } from "./whoami.js";
import { registerCases, type CasesDeps } from "./cases/index.js";

/**
 * Aggregate dependencies for every tool registered by
 * `@testplanit/mcp-server`. Phase 5 introduced WhoamiDeps; Phase 6 extends
 * with CasesDeps (cases list + get read tools).
 */
export type ToolRegistryDeps = WhoamiDeps & CasesDeps;

/**
 * Register every tool shipped by `@testplanit/mcp-server`.
 *
 * Tools are grouped by domain: whoami (debug/identity), cases (CASE-01..02).
 * Plans 06-03..05 add more tools here without further edits to server.ts.
 */
export function registerAll(
  server: McpServer,
  deps: ToolRegistryDeps,
): void {
  registerWhoami(server, deps);
  registerCases(server, deps);
}

export { registerWhoami, registerCases };
export type { WhoamiDeps } from "./whoami.js";
export type { CasesDeps } from "./cases/index.js";
