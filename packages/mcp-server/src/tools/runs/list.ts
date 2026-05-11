import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  RUN_ROW_INCLUDE,
  computeStatusRollup,
  mapRunRow,
  type RawRunRow,
  type StatusGroup,
} from "./shared.js";

export interface RunsListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Per-page batched groupBy result row. The handler issues ONE groupBy across
 * the whole page (`testRunId.in: [...pageIds]`) and fans the rollup out per
 * row via `computeStatusRollup` — never N per-row groupBy calls (D7-06 +
 * RESEARCH Q1/Q2 RESOLVED).
 */
interface BatchedStatusGroup extends StatusGroup {
  testRunId: number;
}

export function registerRunsList(
  server: McpServer,
  deps: RunsListDeps,
): void {
  server.registerTool(
    "testplanit_test_runs_list",
    {
      description:
        "List test runs scoped to a project, with statusCounts rollup inline on every row (per D7-06). Filters: stateId, isCompleted, createdById (user id, string), from/to (createdAt date range, ISO 8601). Cursor pagination via the `cursor` returned in `nextCursor`. Each row carries denormalized project/state/createdBy/configuration/milestone/tags/issues + testRunType + `statusCounts: [{id,name,count}]` + `untested` + `total` (counts SUM to total). The rollup is fetched via a SINGLE batched groupBy per page, NOT per-row — agents can list 100 runs in one tool call without N+1 cost. (per EXEC-01 / D7-06)",
      inputSchema: {
        projectId: z.number().int().positive(),
        stateId: z.number().int().positive().optional(),
        isCompleted: z.boolean().optional(),
        createdById: z.string().min(1).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;

        const where: Record<string, unknown> = {
          projectId: input.projectId,
          isDeleted: false,
        };
        if (input.stateId !== undefined) where.stateId = input.stateId;
        if (input.isCompleted !== undefined) where.isCompleted = input.isCompleted;
        if (input.createdById) where.createdById = input.createdById;
        if (input.from || input.to) {
          where.createdAt = {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          };
        }

        const body: Record<string, unknown> = {
          where,
          include: RUN_ROW_INCLUDE,
          // BL-04: deterministic page ordering. Newest run first; id breaks ties
          // for runs created in the same millisecond.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        // Call 1 — page rows.
        const rows =
          (await zenstack<RawRunRow[]>(
            "testRuns",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const pageIds = trimmed.map((r) => r.id);

        // Call 2 — single batched groupBy across the whole trimmed page (D7-06).
        // Skipped entirely when the page is empty — no wasted round trips.
        let groups: BatchedStatusGroup[] = [];
        if (pageIds.length > 0) {
          groups =
            (await zenstack<BatchedStatusGroup[]>(
              "testRunCases",
              "groupBy",
              {
                by: ["testRunId", "statusId"],
                // R1: TestRunCases has NO isDeleted; do NOT add `isDeleted: false`.
                where: { testRunId: { in: pageIds } },
                _count: { id: true },
              },
              deps.env,
            )) ?? [];
        }

        // Call 3 — resolve names for non-null statusIds only. Skipped when
        // every grouped status is null (e.g., a page of runs with no executed
        // cases yet — R6 efficiency).
        const nonNullStatusIds = Array.from(
          new Set(
            groups
              .map((g) => g.statusId)
              .filter((id): id is number => id !== null),
          ),
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
                },
                deps.env,
              )) ?? []);
        const nameById = new Map<number, string>(
          statuses.map((s) => [s.id, s.name]),
        );

        // Fan rollup out per run via the shared helper (single source of
        // truth — no inlined sums or option-resolution arithmetic here).
        const groupsByRun = new Map<number, StatusGroup[]>();
        for (const g of groups) {
          const arr = groupsByRun.get(g.testRunId) ?? [];
          arr.push({ statusId: g.statusId, _count: g._count });
          groupsByRun.set(g.testRunId, arr);
        }

        const items = trimmed.map((r) => {
          const rollup = computeStatusRollup(
            groupsByRun.get(r.id) ?? [],
            nameById,
          );
          return {
            ...mapRunRow(r),
            statusCounts: rollup.statusCounts,
            untested: rollup.untested,
            total: rollup.total,
          };
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
