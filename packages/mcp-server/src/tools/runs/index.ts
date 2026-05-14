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
import { registerRunsCreate, type RunsCreateDeps } from "./create.js";
import { registerRunsUpdate, type RunsUpdateDeps } from "./update.js";
import { registerRunsCasesAdd, type RunsCasesAddDeps } from "./cases-add.js";

export type RunsDeps =
  & RunsListDeps
  & RunsGetDeps
  & RunsCasesListDeps
  & RunResultsDeps
  & RunsCreateDeps
  & RunsUpdateDeps
  & RunsCasesAddDeps;

export function registerRuns(server: McpServer, deps: RunsDeps): void {
  registerRunsList(server, deps);
  registerRunsGet(server, deps);
  registerRunsCasesList(server, deps);
  registerRunResults(server, deps);
  registerRunsCreate(server, deps);
  registerRunsUpdate(server, deps);
  registerRunsCasesAdd(server, deps);
}

export {
  registerRunsList,
  registerRunsGet,
  registerRunsCasesList,
  registerRunResults,
  registerRunsCreate,
  registerRunsUpdate,
  registerRunsCasesAdd,
};
export type {
  RunsListDeps,
  RunsGetDeps,
  RunsCasesListDeps,
  RunResultsDeps,
  RunsCreateDeps,
  RunsUpdateDeps,
  RunsCasesAddDeps,
};
