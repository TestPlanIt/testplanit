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
import {
  registerSessionsCreate,
  type SessionsCreateDeps,
} from "./create.js";
import {
  registerSessionsUpdate,
  type SessionsUpdateDeps,
} from "./update.js";

export type SessionsDeps = SessionsListDeps &
  SessionsGetDeps &
  SessionResultsDeps &
  SessionsFindingsDeps &
  SessionsCreateDeps &
  SessionsUpdateDeps;

export function registerSessions(
  server: McpServer,
  deps: SessionsDeps,
): void {
  registerSessionsList(server, deps);
  registerSessionsGet(server, deps);
  registerSessionResults(server, deps);
  registerSessionsFindings(server, deps);
  registerSessionsCreate(server, deps);
  registerSessionsUpdate(server, deps);
}

export {
  registerSessionsList,
  registerSessionsGet,
  registerSessionResults,
  registerSessionsFindings,
  registerSessionsCreate,
  registerSessionsUpdate,
};
export type {
  SessionsListDeps,
  SessionsGetDeps,
  SessionResultsDeps,
  SessionsFindingsDeps,
  SessionsCreateDeps,
  SessionsUpdateDeps,
};
