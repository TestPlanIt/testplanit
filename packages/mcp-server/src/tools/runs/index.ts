import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRunsList, type RunsListDeps } from "./list.js";
import { registerRunsGet, type RunsGetDeps } from "./get.js";
import {
  registerRunsCasesList,
  type RunsCasesListDeps,
} from "./cases.js";
import {
  registerRunResults,
  type RunResultsDeps,
} from "./results/index.js";

/**
 * Aggregate dependencies for the Phase 7 test-run read tools. The five
 * tools share the same EnvConfig; this intersection mirrors the cases /
 * folders / tags / projects pattern from Phase 6 so callers can pass a
 * single deps object to `registerRuns`. Plan 07-03 added the EXEC-04 /
 * EXEC-05 result tools via `RunResultsDeps`.
 */
export type RunsDeps =
  & RunsListDeps
  & RunsGetDeps
  & RunsCasesListDeps
  & RunResultsDeps;

export function registerRuns(server: McpServer, deps: RunsDeps): void {
  registerRunsList(server, deps);
  registerRunsGet(server, deps);
  registerRunsCasesList(server, deps);
  registerRunResults(server, deps);
}

export {
  registerRunsList,
  registerRunsGet,
  registerRunsCasesList,
  registerRunResults,
};
export type {
  RunsListDeps,
  RunsGetDeps,
  RunsCasesListDeps,
  RunResultsDeps,
};
