import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRunResultsList, type RunResultsListDeps } from "./list.js";
import { registerRunResultsGet, type RunResultsGetDeps } from "./get.js";

/**
 * Aggregate dependencies for the EXEC-04 / EXEC-05 test-run-result read
 * tools. Both tools share the same EnvConfig; this intersection lets the
 * parent registerRuns pass a single deps object (mirrors the runs / cases
 * / folders / tags pattern).
 */
export type RunResultsDeps = RunResultsListDeps & RunResultsGetDeps;

export function registerRunResults(
  server: McpServer,
  deps: RunResultsDeps,
): void {
  registerRunResultsList(server, deps);
  registerRunResultsGet(server, deps);
}

export { registerRunResultsList, registerRunResultsGet };
export type { RunResultsListDeps, RunResultsGetDeps };
