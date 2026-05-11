import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerSessionResultsList,
  type SessionResultsListDeps,
} from "./list.js";
import {
  registerSessionResultsGet,
  type SessionResultsGetDeps,
} from "./get.js";

/**
 * Aggregate dependencies for the SESS-03 / SESS-04 session-result read tools.
 * Both tools share the same EnvConfig; this intersection lets the parent
 * `registerSessions` pass a single deps object (mirrors the runs/results
 * pattern from plan 07-03).
 */
export type SessionResultsDeps = SessionResultsListDeps & SessionResultsGetDeps;

export function registerSessionResults(
  server: McpServer,
  deps: SessionResultsDeps,
): void {
  registerSessionResultsList(server, deps);
  registerSessionResultsGet(server, deps);
}

export { registerSessionResultsList, registerSessionResultsGet };
export type { SessionResultsListDeps, SessionResultsGetDeps };
