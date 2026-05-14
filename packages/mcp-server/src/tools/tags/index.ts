import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTagsList, type TagsListDeps } from "./list.js";

export type TagsDeps = TagsListDeps;

export function registerTags(server: McpServer, deps: TagsDeps): void {
  registerTagsList(server, deps);
}

export { registerTagsList };
export type { TagsListDeps };
