import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TagsInclude } from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

type TagsCountOutputTypeSelect = Extract<
  NonNullable<TagsInclude["_count"]>,
  { select: unknown }
>["select"];

export interface TagsListDeps {
  env: EnvConfig;
}

interface RawTagRow {
  id: number;
  name: string;
  _count?: {
    // RepositoryCases links now live on the explicit RepositoryCaseTag join
    // model, so the case count comes from caseTags. testRuns / sessions are
    // still implicit m2m and counted directly.
    caseTags?: number;
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
        const countSelect: TagsCountOutputTypeSelect = input.projectId
          ? {
              // caseTags is the RepositoryCaseTag join; scope through the
              // linked case's project + soft-delete.
              caseTags: {
                where: {
                  case: { isDeleted: false, projectId: input.projectId },
                },
              },
              testRuns: {
                where: { isDeleted: false, projectId: input.projectId },
              },
              sessions: {
                where: { isDeleted: false, projectId: input.projectId },
              },
            }
          : {
              caseTags: true,
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
            repositoryCases: r._count?.caseTags ?? 0,
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
