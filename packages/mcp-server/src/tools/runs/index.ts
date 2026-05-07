import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRunsList, type RunsListDeps } from "./list.js";
import { registerRunsGet, type RunsGetDeps } from "./get.js";
import {
  registerRunsCasesList,
  type RunsCasesListDeps,
} from "./cases.js";

/**
 * Aggregate dependencies for the Phase 7 test-run read tools. The three
 * tools share the same EnvConfig; this intersection mirrors the cases /
 * folders / tags / projects pattern from Phase 6 so callers can pass a
 * single deps object to `registerRuns`.
 */
export type RunsDeps =
  & RunsListDeps
  & RunsGetDeps
  & RunsCasesListDeps;

export function registerRuns(server: McpServer, deps: RunsDeps): void {
  registerRunsList(server, deps);
  registerRunsGet(server, deps);
  registerRunsCasesList(server, deps);
}

export { registerRunsList, registerRunsGet, registerRunsCasesList };
export type { RunsListDeps, RunsGetDeps, RunsCasesListDeps };
