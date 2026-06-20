import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTemplatesList, type TemplatesListDeps } from "./list.js";

export type TemplatesDeps = TemplatesListDeps;

export function registerTemplates(server: McpServer, deps: TemplatesDeps): void {
  registerTemplatesList(server, deps);
}

export { registerTemplatesList };
export type { TemplatesListDeps };
