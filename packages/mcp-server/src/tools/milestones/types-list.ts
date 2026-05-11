import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface MilestoneTypesListDeps {
  env: EnvConfig;
}

interface RawMilestoneTypeRow {
  id: number;
  name: string;
  isDefault: boolean;
}

/**
 * `testplanit_milestone_types_list` — milestone types assigned to a project
 * via the `MilestoneTypesAssignment` junction. Returns
 * `{items: [{id, name, isDefault}]}` ordered by name. No cursor pagination —
 * types-per-project is small (~10 typical). Every milestones_list row + get
 * response also denormalizes milestoneType:{id,name} inline; this tool
 * exists for full-catalog and filter-picker use cases.
 */
export function registerMilestoneTypesList(
  server: McpServer,
  deps: MilestoneTypesListDeps,
): void {
  server.registerTool(
    "testplanit_milestone_types_list",
    {
      description:
        "List all milestone types assigned to a project (via the MilestoneTypesAssignment junction). Returns {items:[{id, name, isDefault}]} sorted by name asc. No cursor pagination — types-per-project is small (~10 typical). Every milestones_list row + milestones_get response also denormalizes milestoneType:{id,name} inline; this tool exists for full-catalog or filter-picker use cases. No icon field — schema only carries an icon class identifier, deliberately dropped for v1.",
      inputSchema: { projectId: z.number().int().positive() },
    },
    async (input) => {
      try {
        const rows = await zenstack<RawMilestoneTypeRow[]>(
          "milestoneTypes",
          "findMany",
          {
            where: {
              isDeleted: false,
              projects: { some: { projectId: input.projectId } },
            },
            select: { id: true, name: true, isDefault: true },
            orderBy: { name: "asc" },
          },
          deps.env,
        );
        const items = (rows ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          isDefault: r.isDefault,
        }));
        const out = { items };
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
