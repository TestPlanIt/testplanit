import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCasesList, type CasesListDeps } from "./list.js";
import { registerCasesGet, type CasesGetDeps } from "./get.js";
import { registerCasesCreate, type CasesCreateDeps } from "./create.js";
import {
  registerCasesCreateMany,
  type CasesCreateManyDeps,
} from "./createMany.js";
import { registerCasesUpdate, type CasesUpdateDeps } from "./update.js";
import { registerCasesDelete, type CasesDeleteDeps } from "./delete.js";
import {
  registerCasesGenerateScript,
  type CasesGenerateScriptDeps,
} from "./generate-script.js";

export type CasesDeps =
  & CasesListDeps
  & CasesGetDeps
  & CasesCreateDeps
  & CasesCreateManyDeps
  & CasesUpdateDeps
  & CasesDeleteDeps
  & CasesGenerateScriptDeps;

export function registerCases(server: McpServer, deps: CasesDeps): void {
  registerCasesList(server, deps);
  registerCasesGet(server, deps);
  registerCasesCreate(server, deps);
  registerCasesCreateMany(server, deps);
  registerCasesUpdate(server, deps);
  registerCasesDelete(server, deps);
  registerCasesGenerateScript(server, deps);
}

export {
  registerCasesList,
  registerCasesGet,
  registerCasesCreate,
  registerCasesCreateMany,
  registerCasesUpdate,
  registerCasesDelete,
  registerCasesGenerateScript,
};
export type {
  CasesListDeps,
  CasesGetDeps,
  CasesCreateDeps,
  CasesCreateManyDeps,
  CasesUpdateDeps,
  CasesDeleteDeps,
  CasesGenerateScriptDeps,
};
