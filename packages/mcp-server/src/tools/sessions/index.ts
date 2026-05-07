import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSessionsList, type SessionsListDeps } from "./list.js";
import { registerSessionsGet, type SessionsGetDeps } from "./get.js";
import {
  registerSessionResults,
  type SessionResultsDeps,
} from "./results/index.js";
import {
  registerSessionsFindings,
  type SessionsFindingsDeps,
} from "./findings.js";

/**
 * Aggregate dependencies for the Phase 7 session-domain read tools. All five
 * tools share the same EnvConfig; this intersection mirrors the runs / cases
 * / folders pattern so callers can pass a single deps object.
 *
 * Phase 7 plan 04 shipped sessions_list (SESS-01) + sessions_get (SESS-02);
 * plan 05 extends additively with session_results_list (SESS-03),
 * session_results_get (SESS-04), and sessions_findings_list (SESS-05). The
 * upstream `ToolRegistryDeps` widens through the existing intersection chain
 * — no edits needed to `tools/index.ts` or `src/index.ts`.
 */
export type SessionsDeps = SessionsListDeps &
  SessionsGetDeps &
  SessionResultsDeps &
  SessionsFindingsDeps;

export function registerSessions(
  server: McpServer,
  deps: SessionsDeps,
): void {
  registerSessionsList(server, deps);
  registerSessionsGet(server, deps);
  registerSessionResults(server, deps);
  registerSessionsFindings(server, deps);
}

export {
  registerSessionsList,
  registerSessionsGet,
  registerSessionResults,
  registerSessionsFindings,
};
export type {
  SessionsListDeps,
  SessionsGetDeps,
  SessionResultsDeps,
  SessionsFindingsDeps,
};
