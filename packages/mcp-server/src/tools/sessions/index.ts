import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSessionsList, type SessionsListDeps } from "./list.js";
import { registerSessionsGet, type SessionsGetDeps } from "./get.js";

/**
 * Aggregate dependencies for the Phase 7 session read tools. Both tools share
 * the same EnvConfig; this intersection mirrors the runs / cases / folders
 * pattern so callers can pass a single deps object to `registerSessions`.
 *
 * NOTE: Plan 07-05 will EXTEND this intersection to add session-results
 * list/get and findings (SESS-03..05). The aggregate widens additively —
 * downstream callers (tools/index.ts, src/index.ts) pick up the new deps
 * automatically through the existing `& SessionsDeps` chain.
 */
export type SessionsDeps = SessionsListDeps & SessionsGetDeps;

export function registerSessions(
  server: McpServer,
  deps: SessionsDeps,
): void {
  registerSessionsList(server, deps);
  registerSessionsGet(server, deps);
}

export { registerSessionsList, registerSessionsGet };
export type { SessionsListDeps, SessionsGetDeps };
