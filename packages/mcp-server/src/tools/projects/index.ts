import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectsList, type ProjectsListDeps } from "./list.js";

export type ProjectsDeps = ProjectsListDeps;

export function registerProjects(server: McpServer, deps: ProjectsDeps): void {
  registerProjectsList(server, deps);
}

export { registerProjectsList };
export type { ProjectsListDeps };
