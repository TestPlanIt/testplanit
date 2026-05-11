import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface ProjectsListDeps {
  env: EnvConfig;
}

const PROJECTS_LIST_SELECT = {
  id: true,
  name: true,
} as const;

/**
 * List projects accessible to the authenticated token.
 *
 * Claude's Discretion include (CONTEXT.md): without this tool, agents must
 * know the projectId out-of-band. Adding a 1-zenstack-call read tool
 * removes that friction. The host's ZenStack `@@allow` policy filters
 * rows per token; cross-tenant projects are absent automatically.
 *
 * The `select: { id: true, name: true }` keeps the response minimal —
 * no description, isArchived, tenantId, or other admin-domain fields
 * are exposed even if a future schema change widens the policy.
 */
export function registerProjectsList(
  server: McpServer,
  deps: ProjectsListDeps,
): void {
  server.registerTool(
    "testplanit_projects_list",
    {
      description:
        "List projects accessible to the authenticated token. Returns { id, name } pairs only — minimal context-disambiguation surface for agents.",
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await zenstack<Array<{ id: number; name: string }>>(
          "projects",
          "findMany",
          {
            where: { isDeleted: false },
            select: PROJECTS_LIST_SELECT,
            orderBy: { name: "asc" },
          },
          deps.env,
        );
        const out = { projects: rows ?? [] };
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
