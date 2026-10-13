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
import {
  registerIssuesLink,
  registerIssuesUnlink,
  type IssuesLinkDeps,
} from "./link.js";
import { registerIssuesResolve, type IssuesResolveDeps } from "./resolve.js";

export type IssuesDeps = IssuesFindByKeyDeps &
  IssuesListDeps &
  IssuesGetDeps &
  IssuesListLinksDeps &
  IssuesLinkDeps &
  IssuesResolveDeps;

export function registerIssues(server: McpServer, deps: IssuesDeps): void {
  registerIssuesFindByKey(server, deps);
  registerIssuesResolve(server, deps);
  registerIssuesList(server, deps);
  registerIssuesGet(server, deps);
  registerIssuesListLinks(server, deps);
  registerIssuesLink(server, deps);
  registerIssuesUnlink(server, deps);
}

export {
  registerIssuesFindByKey,
  registerIssuesList,
  registerIssuesGet,
  registerIssuesListLinks,
  registerIssuesLink,
  registerIssuesUnlink,
  registerIssuesResolve,
};
export type {
  IssuesFindByKeyDeps,
  IssuesListDeps,
  IssuesGetDeps,
  IssuesListLinksDeps,
  IssuesLinkDeps,
  IssuesResolveDeps,
};
