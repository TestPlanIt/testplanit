import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import {
  RUN_RESULT_LIST_INCLUDE,
  mapRunResultRow,
  type RawRunResultRow,
} from "../shared.js";

export interface RunResultsListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_CASE_IDS = 500;

export function registerRunResultsList(
  server: McpServer,
  deps: RunResultsListDeps,
): void {
  server.registerTool(
    "testplanit_test_run_results_list",
    {
      description:
        "List test run results across runs. Filters: runId, caseIds (RepositoryCases ids — back-half of EXEC-06 chain when paired with testplanit_cases_list({issueId})), executedById (user id, string), statusId, from/to (executedAt date range, ISO 8601). Cursor pagination ordered by executedAt DESC then id DESC (BL-04 deterministic + D7-02 latest-first). Each row carries denormalized status/executedBy/testRunCase (with repositoryCase + testRun summary). For step-level detail call testplanit_test_run_results_get with the row id. (per EXEC-04 / D7-01)",
      inputSchema: {
        runId: z.number().int().positive().optional(),
        caseIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(MAX_CASE_IDS)
          .optional(),
        executedById: z.string().min(1).optional(),
        statusId: z.number().int().positive().optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;
        // TestRunResults HAS isDeleted (schema.zmodel:2393 area). Defense-in-depth:
        // every code path that builds `where` starts from this base object so no
        // input branch can drop the soft-delete filter.
        const where: Record<string, unknown> = { isDeleted: false };
        if (input.runId !== undefined) where.testRunId = input.runId;
        if (input.caseIds && input.caseIds.length > 0) {
          // EXEC-06 back-half: nested relation filter via
          // `where.testRunCase.repositoryCaseId.in` — Prisma expands this to a
          // join + IN over RepositoryCases.id, scoped per-row by the host's
          // ZenStack @@allow policy. Cross-tenant rows can't leak through
          // this filter (T-07-02 / T-07-04).
          where.testRunCase = { repositoryCaseId: { in: input.caseIds } };
        }
        if (input.executedById) where.executedById = input.executedById;
        if (input.statusId !== undefined) where.statusId = input.statusId;
        if (input.from || input.to) {
          where.executedAt = {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          };
        }

        const body: Record<string, unknown> = {
          where,
          include: RUN_RESULT_LIST_INCLUDE,
          // BL-04 deterministic ordering — D7-02 latest-first (matches the
          // (testRunCaseId, executedAt(sort: Desc)) schema index); id breaks
          // ties for results recorded in the same millisecond.
          orderBy: [{ executedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        const rows =
          (await zenstack<RawRunResultRow[]>(
            "testRunResults",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const items = trimmed.map(mapRunResultRow);
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
