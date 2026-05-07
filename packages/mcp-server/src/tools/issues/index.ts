import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerIssuesFindByKey,
  type IssuesFindByKeyDeps,
} from "./find-by-key.js";
import { registerIssuesList, type IssuesListDeps } from "./list.js";
import { registerIssuesGet, type IssuesGetDeps } from "./get.js";
import {
  registerIssuesListLinks,
  type IssuesListLinksDeps,
} from "./links.js";

/**
 * Aggregate dependencies for the Phase 8 issue-domain read tools. All four
 * tools share the same EnvConfig; this intersection mirrors the runs / cases
 * / sessions barrel pattern so callers can pass a single deps object.
 *
 * Plan 08-02 ships find-by-key (ISSUE-01), list (ISSUE-02), get (ISSUE-03),
 * and list_links (ISSUE-04). Registry wiring into ToolRegistryDeps is
 * deferred to plan 08-05.
 */
export type IssuesDeps = IssuesFindByKeyDeps &
  IssuesListDeps &
  IssuesGetDeps &
  IssuesListLinksDeps;

export function registerIssues(server: McpServer, deps: IssuesDeps): void {
  registerIssuesFindByKey(server, deps);
  registerIssuesList(server, deps);
  registerIssuesGet(server, deps);
  registerIssuesListLinks(server, deps);
}

export {
  registerIssuesFindByKey,
  registerIssuesList,
  registerIssuesGet,
  registerIssuesListLinks,
};
export type {
  IssuesFindByKeyDeps,
  IssuesListDeps,
  IssuesGetDeps,
  IssuesListLinksDeps,
};
