import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWhoami, type WhoamiDeps } from "./whoami.js";

/**
 * Aggregate dependencies for every tool registered by
 * `@testplanit/mcp-server`. Phase 5 only uses `WhoamiDeps`; Phase 6+ will
 * extend the interface with case/folder/tag/run dependencies.
 */
export type ToolRegistryDeps = WhoamiDeps;

/**
 * Register every tool shipped by `@testplanit/mcp-server`.
 *
 * Plan 05-07 ships only `whoami`. The registry exists now so Phase 6+
 * tools (case/folder/tag/run accessors) plug in here without further
 * edits to `server.ts`.
 */
export function registerAll(
  server: McpServer,
  deps: ToolRegistryDeps,
): void {
  registerWhoami(server, deps);
}

export { registerWhoami };
export type { WhoamiDeps } from "./whoami.js";
