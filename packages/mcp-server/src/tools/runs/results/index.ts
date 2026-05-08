import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRunResultsList, type RunResultsListDeps } from "./list.js";
import { registerRunResultsGet, type RunResultsGetDeps } from "./get.js";
import {
  registerRunResultsCreate,
  type RunResultsCreateDeps,
} from "./create.js";

export type RunResultsDeps = RunResultsListDeps &
  RunResultsGetDeps &
  RunResultsCreateDeps;

export function registerRunResults(
  server: McpServer,
  deps: RunResultsDeps,
): void {
  registerRunResultsList(server, deps);
  registerRunResultsGet(server, deps);
  registerRunResultsCreate(server, deps);
}

export { registerRunResultsList, registerRunResultsGet, registerRunResultsCreate };
export type { RunResultsListDeps, RunResultsGetDeps, RunResultsCreateDeps };
