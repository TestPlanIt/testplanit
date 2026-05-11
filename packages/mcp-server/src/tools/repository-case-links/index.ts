import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerRepositoryCaseLinksList,
  type RepositoryCaseLinksListDeps,
} from "./list.js";

export type RepositoryCaseLinksDeps = RepositoryCaseLinksListDeps;

export function registerRepositoryCaseLinks(
  server: McpServer,
  deps: RepositoryCaseLinksDeps,
): void {
  registerRepositoryCaseLinksList(server, deps);
}

export { registerRepositoryCaseLinksList };
export type { RepositoryCaseLinksListDeps };
