import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  TestRunCasesGroupByArgs,
  TestRunsWhereInput,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  RUN_ROW_INCLUDE,
  computeStatusRollup,
  extractJunitStatusGroupsByRun,
  isAutomatedRunType,
  mapRunRow,
  resolveStatusNames,
  type RawRunRow,
  type StatusGroup,
} from "./shared.js";

export interface RunsListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Per-page batched groupBy result row for REGULAR runs. The handler issues
 * ONE groupBy across the page's REGULAR ids (`testRunId.in: [...regularIds]`)
 * and fans the rollup out per row via `computeStatusRollup` — never N per-row
 * groupBy calls (D7-06 + RESEARCH Q1/Q2 RESOLVED). Automated runs roll up via
 * extractJunitStatusGroupsByRun (suite lookup + one JUnitTestResult groupBy),
 * equally batched.
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
        "List test runs scoped to a project, with statusCounts rollup inline on every row (per D7-06). Filters: stateId, isCompleted, createdById (user id, string), from/to (createdAt date range, ISO 8601). Cursor pagination via the `cursor` returned in `nextCursor`. Each row carries denormalized project/state/createdBy/configuration/milestone/tags/issues + testRunType + `statusCounts: [{id,name,count}]` + `untested` + `total` (counts SUM to total). Rollup source depends on testRunType: REGULAR runs count TestRunCases by execution status (`untested` = cases with no result, `total` = case count); automated runs (JUNIT/TESTNG/XUNIT/NUNIT/MSTEST/MOCHA/CUCUMBER) count imported JUnit result ROWS by status — attempts, so retries count once per row and `total` is the attempt count, matching the web UI. Rollups are fetched via batched groupBy calls per page, NOT per-row — agents can list 100 runs in one tool call without N+1 cost. (per EXEC-01 / D7-06)",
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

        const where: TestRunsWhereInput = {
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
        // Rollup source splits on testRunType: REGULAR runs count
        // TestRunCases.statusId; automated runs count JUnitTestResult rows
        // (attempts — the web UI's semantics; TestRunCases junction rows for
        // automated runs never get a statusId, which is what made them read
        // as 100% untested here).
        const regularIds = trimmed
          .filter((r) => !isAutomatedRunType(r.testRunType))
          .map((r) => r.id);
        const automatedIds = trimmed
          .filter((r) => isAutomatedRunType(r.testRunType))
          .map((r) => r.id);

        // Call 2 — batched per source, in parallel (D7-06: never per-row).
        //   REGULAR    → one testRunCases.groupBy over the regular page ids.
        //   automated  → one jUnitTestSuite.findMany + one
        //                jUnitTestResult.groupBy over the automated page ids.
        // Either branch is skipped entirely when it has no runs on the page.
        const [groups, junitGroupsByRun] = await Promise.all([
          regularIds.length > 0
            ? zenstack<BatchedStatusGroup[]>(
                "testRunCases",
                "groupBy",
                {
                  by: ["testRunId", "statusId"],
                  // R1 (revised): exclude soft-removed run cases from rollups.
                  where: { testRunId: { in: regularIds }, isDeleted: false },
                  _count: { id: true },
                } satisfies TestRunCasesGroupByArgs,
                deps.env,
              ).then((g) => g ?? [])
            : Promise.resolve<BatchedStatusGroup[]>([]),
          extractJunitStatusGroupsByRun(automatedIds, deps.env),
        ]);

        // Call 3 — ONE status.findMany across both sources' non-null
        // statusIds. Skipped when every grouped status is null (R6).
        const nameById = await resolveStatusNames(
          [
            ...groups.map((g) => g.statusId),
            ...Array.from(junitGroupsByRun.values()).flatMap((gs) =>
              gs.map((g) => g.statusId),
            ),
          ],
          deps.env,
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
          const sourceGroups = isAutomatedRunType(r.testRunType)
            ? (junitGroupsByRun.get(r.id) ?? [])
            : (groupsByRun.get(r.id) ?? []);
          const rollup = computeStatusRollup(sourceGroups, nameById);
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
