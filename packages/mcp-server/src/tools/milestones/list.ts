import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  MILESTONE_ROW_INCLUDE,
  computeStatusRollup,
  fetchDescendantCounts,
  mapMilestoneRow,
  mergeMilestoneStatusGroups,
  type BatchedRunGroup,
  type BatchedSessionGroup,
  type RawMilestoneRow,
  type StatusGroup,
} from "./shared.js";

export interface MilestonesListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * `testplanit_milestones_list` — milestones for a project, with the pooled
 * `statusCounts` rollup inline on every row.
 *
 * Per-page call sequence (at most 5 round trips):
 *   1. milestones.findMany — page rows + internal testRun/session id arrays.
 *   2. testRunCases.groupBy by [testRunId, statusId] — skipped if no runs.
 *   3. sessionResults.groupBy by [sessionId, statusId] — skipped if no
 *      sessions.
 *   4. status.findMany — skipped if every grouped statusId is null (no
 *      executed work yet).
 *   5. GET /api/mcp/milestones-descendants — batched recursive CTE for
 *      `totalDescendants` across the whole page.
 *
 * Never per-row: the rollup helpers fan a single page-wide groupBy result
 * back to each milestone via in-memory merge.
 */
export function registerMilestonesList(
  server: McpServer,
  deps: MilestonesListDeps,
): void {
  server.registerTool(
    "testplanit_milestones_list",
    {
      description:
        "List milestones scoped to a project, with POOLED statusCounts rollup inline on every row (merged across linked test runs AND linked sessions). Filters: isCompleted, isStarted, milestoneTypeId, createdById (single string), from/to (ISO 8601 createdAt range), parentId (null = root-only, number = direct children of, omitted = all). Cursor pagination via the `cursor` returned in `nextCursor`. Each row carries denormalized milestoneType {id,name}, creator, parentId, directChildrenCount, totalDescendants (recursive CTE), commentCount inline, plus statusCounts:[{id,name,count}] + untested + total (counts SUM to total). Two batched groupBy calls per page (testRunCases + sessionResults), never per-row. No icon field — schema only carries an icon class identifier, deliberately dropped for v1.",
      inputSchema: {
        projectId: z.number().int().positive(),
        isCompleted: z.boolean().optional(),
        isStarted: z.boolean().optional(),
        milestoneTypeId: z.number().int().positive().optional(),
        createdById: z.string().trim().min(1).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        // Three states — null (root-only), number (children-of), undefined (all)
        parentId: z
          .union([z.number().int().positive(), z.null()])
          .optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;

        const where: Prisma.MilestonesWhereInput = {
          projectId: input.projectId,
          isDeleted: false,
        };
        if (input.isCompleted !== undefined) {
          where.isCompleted = input.isCompleted;
        }
        if (input.isStarted !== undefined) {
          where.isStarted = input.isStarted;
        }
        // Schema FK column is plural: `milestoneTypesId`.
        if (input.milestoneTypeId !== undefined) {
          where.milestoneTypesId = input.milestoneTypeId;
        }
        // Schema scalar field is `createdBy` (String); `creator` is the relation.
        if (input.createdById) {
          where.createdBy = input.createdById;
        }
        if (input.from || input.to) {
          where.createdAt = {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          };
        }
        // Three-branch parentId — explicit null check distinguishes
        // "root-only" from "all" semantics.
        if (input.parentId === null) {
          where.parentId = null;
        } else if (input.parentId !== undefined) {
          where.parentId = input.parentId;
        }
        // omitted → no where.parentId key (all milestones)

        const body: Record<string, unknown> = {
          where,
          include: MILESTONE_ROW_INCLUDE,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        // Call 1 — milestones.findMany.
        const rows =
          (await zenstack<RawMilestoneRow[]>(
            "milestones",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const pageIds = trimmed.map((r) => r.id);

        // Lookup tables for the merge fan-out and the all-* id arrays for
        // the two batched groupBy calls.
        const runIdToMilestoneId = new Map<number, number>();
        const sessionIdToMilestoneId = new Map<number, number>();
        const allRunIds: number[] = [];
        const allSessionIds: number[] = [];
        for (const m of trimmed) {
          for (const r of m.testRuns ?? []) {
            runIdToMilestoneId.set(r.id, m.id);
            allRunIds.push(r.id);
          }
          for (const s of m.sessions ?? []) {
            sessionIdToMilestoneId.set(s.id, m.id);
            allSessionIds.push(s.id);
          }
        }

        // Call 2 — testRunCases.groupBy. TestRunCases has no `isDeleted`
        // column (cascade deletes only); never add it to the where.
        let runGroups: BatchedRunGroup[] = [];
        if (allRunIds.length > 0) {
          runGroups =
            (await zenstack<BatchedRunGroup[]>(
              "testRunCases",
              "groupBy",
              {
                by: ["testRunId", "statusId"],
                where: { testRunId: { in: allRunIds } },
                _count: { id: true },
              } satisfies Prisma.TestRunCasesGroupByArgs,
              deps.env,
            )) ?? [];
        }

        // Call 3 — sessionResults.groupBy. SessionResults DOES have
        // `isDeleted`; defense in depth applies.
        let sessionGroups: BatchedSessionGroup[] = [];
        if (allSessionIds.length > 0) {
          sessionGroups =
            (await zenstack<BatchedSessionGroup[]>(
              "sessionResults",
              "groupBy",
              {
                by: ["sessionId", "statusId"],
                where: { sessionId: { in: allSessionIds }, isDeleted: false },
                _count: { id: true },
              } satisfies Prisma.SessionResultsGroupByArgs,
              deps.env,
            )) ?? [];
        }

        // Call 4 — status.findMany for the union of non-null statusIds.
        // Skipped when every grouped status is null (no executed work yet).
        const nonNullStatusIds = Array.from(
          new Set([
            ...runGroups
              .map((g) => g.statusId)
              .filter((id): id is number => id !== null),
            ...sessionGroups.map((g) => g.statusId),
          ]),
        );
        const statuses =
          nonNullStatusIds.length === 0
            ? []
            : ((await zenstack<Array<{ id: number; name: string }>>(
                "status",
                "findMany",
                {
                  where: { id: { in: nonNullStatusIds } },
                  select: { id: true, name: true },
                } satisfies Prisma.StatusFindManyArgs,
                deps.env,
              )) ?? []);
        const nameById = new Map<number, string>(
          statuses.map((s) => [s.id, s.name]),
        );

        // Merge run + session groups back to milestoneId.
        const groupsByMilestone: Map<number, StatusGroup[]> =
          mergeMilestoneStatusGroups({
            runGroups,
            sessionGroups,
            runIdToMilestoneId,
            sessionIdToMilestoneId,
          });

        // Call 5 — host CTE for totalDescendants, batched per page.
        const descendantCounts = await fetchDescendantCounts(pageIds, deps.env);

        const items = trimmed.map((r) => {
          const rollup = computeStatusRollup(
            groupsByMilestone.get(r.id) ?? [],
            nameById,
          );
          return mapMilestoneRow(r, {
            totalDescendants: descendantCounts.get(r.id) ?? 0,
            rollup,
          });
        });

        const nextCursor =
          hasNextPage && items.length > 0
            ? (items[items.length - 1] as { id: number }).id
            : null;

        const result = { items, hasNextPage, nextCursor };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
