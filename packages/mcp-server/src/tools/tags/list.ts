import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface TagsListDeps {
  env: EnvConfig;
}

interface RawTagRow {
  id: number;
  name: string;
  _count?: {
    repositoryCases?: number;
    testRuns?: number;
    sessions?: number;
  };
}

/**
 * List tags with per-tag usage counts (CASE-11).
 *
 * Tags are GLOBAL in the TestPlanIt schema (not project-scoped). When the
 * agent supplies `projectId`, the per-tag counts are scoped to that
 * project's cases/runs/sessions; without projectId, counts are global.
 * Either way, the tag list itself is global.
 */
export function registerTagsList(server: McpServer, deps: TagsListDeps): void {
  server.registerTool(
    "testplanit_tags_list",
    {
      description:
        "List tags with usage counts per repository case / test run / session. Optionally pass projectId to scope counts to that project; without it, counts are global. Tags are global; this tool is read-only.",
      inputSchema: {
        projectId: z.number().int().positive().optional(),
      },
    },
    async (input) => {
      try {
        const countSelect: Record<string, unknown> = input.projectId
          ? {
              repositoryCases: {
                where: { isDeleted: false, projectId: input.projectId },
              },
              testRuns: {
                where: { isDeleted: false, projectId: input.projectId },
              },
              sessions: {
                where: { isDeleted: false, projectId: input.projectId },
              },
            }
          : {
              repositoryCases: true,
              testRuns: true,
              sessions: true,
            };

        const rows = await zenstack<RawTagRow[]>(
          "tags",
          "findMany",
          {
            where: { isDeleted: false },
            include: { _count: { select: countSelect } },
            orderBy: { name: "asc" },
          },
          deps.env,
        );

        const tags = (rows ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          usageCounts: {
            repositoryCases: r._count?.repositoryCases ?? 0,
            testRuns: r._count?.testRuns ?? 0,
            sessions: r._count?.sessions ?? 0,
          },
        }));
        const out = { tags };
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
