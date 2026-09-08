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
import {
  registerRunsCasesUpdate,
  type RunsCasesUpdateDeps,
} from "./cases-update.js";
import {
  registerRunsCasesRemove,
  type RunsCasesRemoveDeps,
} from "./cases-remove.js";

export type RunsDeps =
  & RunsListDeps
  & RunsGetDeps
  & RunsCasesListDeps
  & RunResultsDeps
  & RunsCreateDeps
  & RunsUpdateDeps
  & RunsCasesAddDeps
  & RunsCasesUpdateDeps
  & RunsCasesRemoveDeps;

export function registerRuns(server: McpServer, deps: RunsDeps): void {
  registerRunsList(server, deps);
  registerRunsGet(server, deps);
  registerRunsCasesList(server, deps);
  registerRunResults(server, deps);
  registerRunsCreate(server, deps);
  registerRunsUpdate(server, deps);
  registerRunsCasesAdd(server, deps);
  registerRunsCasesUpdate(server, deps);
  registerRunsCasesRemove(server, deps);
}

export {
  registerRunsList,
  registerRunsGet,
  registerRunsCasesList,
  registerRunResults,
  registerRunsCreate,
  registerRunsUpdate,
  registerRunsCasesAdd,
  registerRunsCasesUpdate,
  registerRunsCasesRemove,
};
export type {
  RunsListDeps,
  RunsGetDeps,
  RunsCasesListDeps,
  RunResultsDeps,
  RunsCreateDeps,
  RunsUpdateDeps,
  RunsCasesAddDeps,
  RunsCasesUpdateDeps,
  RunsCasesRemoveDeps,
};
