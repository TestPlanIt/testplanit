import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCasesList, type CasesListDeps } from "./list.js";
import { registerCasesGet, type CasesGetDeps } from "./get.js";

export type CasesDeps = CasesListDeps & CasesGetDeps;

export function registerCases(server: McpServer, deps: CasesDeps): void {
  registerCasesList(server, deps);
  registerCasesGet(server, deps);
}

export { registerCasesList, registerCasesGet };
export type { CasesListDeps, CasesGetDeps };
