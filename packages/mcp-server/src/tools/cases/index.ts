import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCasesList, type CasesListDeps } from "./list.js";
import { registerCasesGet, type CasesGetDeps } from "./get.js";
import { registerCasesCreate, type CasesCreateDeps } from "./create.js";
import { registerCasesUpdate, type CasesUpdateDeps } from "./update.js";
import { registerCasesDelete, type CasesDeleteDeps } from "./delete.js";

export type CasesDeps =
  & CasesListDeps
  & CasesGetDeps
  & CasesCreateDeps
  & CasesUpdateDeps
  & CasesDeleteDeps;

export function registerCases(server: McpServer, deps: CasesDeps): void {
  registerCasesList(server, deps);
  registerCasesGet(server, deps);
  registerCasesCreate(server, deps);
  registerCasesUpdate(server, deps);
  registerCasesDelete(server, deps);
}

export {
  registerCasesList,
  registerCasesGet,
  registerCasesCreate,
  registerCasesUpdate,
  registerCasesDelete,
};
export type {
  CasesListDeps,
  CasesGetDeps,
  CasesCreateDeps,
  CasesUpdateDeps,
  CasesDeleteDeps,
};
