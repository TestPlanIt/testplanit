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

export type IssuesDeps = IssuesFindByKeyDeps &
  IssuesListDeps &
  IssuesGetDeps &
  IssuesListLinksDeps &
  IssuesLinkDeps;

export function registerIssues(server: McpServer, deps: IssuesDeps): void {
  registerIssuesFindByKey(server, deps);
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
};
export type {
  IssuesFindByKeyDeps,
  IssuesListDeps,
  IssuesGetDeps,
  IssuesListLinksDeps,
  IssuesLinkDeps,
};
