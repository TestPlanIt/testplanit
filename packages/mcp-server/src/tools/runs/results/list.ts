import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  JUnitTestResultWhereInput,
  TestRunResultsWhereInput,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import {
  JUNIT_RESULT_LIST_INCLUDE,
  RUN_RESULT_LIST_INCLUDE,
  mapJunitResultRow,
  mapRunResultRow,
  mergeResultsPage,
  parseResultsCursor,
  type RawJunitResultRow,
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
        "List test run results across runs — BOTH manual results (TestRunResults, source \"TestRun\") AND automated results ingested from JUnit/TestNG/xUnit/NUnit/MSTest/Mocha/Cucumber reports (JUnitTestResult, source \"JUnit\"; automated runs — testRunType != REGULAR — store results ONLY there). Filters: runId, caseIds (RepositoryCases ids — back-half of EXEC-06 chain when paired with testplanit_cases_list({issueId})), executedById (user id, string; for JUnit rows this is the importer), statusId, from/to (executedAt date range, ISO 8601), source (\"TestRun\" | \"JUnit\" to restrict to one kind). Merged ordering: executedAt DESC then id DESC per source (BL-04 deterministic + D7-02 latest-first). Cursor is OPAQUE — pass back `nextCursor` verbatim (compound `tr:<id>|ju:<id>` string; bare numbers are accepted as legacy TestRunResults cursors). Each row carries `source`, denormalized status/executedBy, top-level repositoryCase + testRun, and (TestRun rows only) testRunCase. For detail call testplanit_test_run_results_get with the row id AND its `source`. (per EXEC-04 / D7-01)",
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
        source: z.enum(["TestRun", "JUnit"]).optional(),
        cursor: z
          .union([z.number().int().positive(), z.string().min(1)])
          .optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;
        const cursor = parseResultsCursor(input.cursor);
        if (cursor === null) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Malformed cursor "${String(input.cursor)}" — pass back the nextCursor value from the previous page verbatim.`,
              },
            ],
          };
        }

        // TestRunResults HAS isDeleted (schema.zmodel:2393 area). Defense-in-depth:
        // every code path that builds `where` starts from this base object so no
        // input branch can drop the soft-delete filter.
        const where: TestRunResultsWhereInput = { isDeleted: false };
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

        // Same filters projected onto JUnitTestResult. NO isDeleted — the
        // model has no soft-delete column (Cascade deletes only); the typed
        // where makes adding one a TS2353. The run is reachable only via
        // testSuite.testRunId; executedBy maps to createdById (importer).
        const junitWhere: JUnitTestResultWhereInput = {};
        if (input.runId !== undefined) {
          junitWhere.testSuite = { testRunId: input.runId };
        }
        if (input.caseIds && input.caseIds.length > 0) {
          junitWhere.repositoryCaseId = { in: input.caseIds };
        }
        if (input.executedById) junitWhere.createdById = input.executedById;
        if (input.statusId !== undefined) junitWhere.statusId = input.statusId;
        if (input.from || input.to) {
          junitWhere.executedAt = {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          };
        }

        const wantTestRun = input.source !== "JUnit";
        const wantJunit = input.source !== "TestRun";

        const trBody: Record<string, unknown> = {
          where,
          include: RUN_RESULT_LIST_INCLUDE,
          // BL-04 deterministic ordering — D7-02 latest-first (matches the
          // (testRunCaseId, executedAt(sort: Desc)) schema index); id breaks
          // ties for results recorded in the same millisecond.
          orderBy: [{ executedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (cursor.tr !== undefined) {
          trBody.cursor = { id: cursor.tr };
          trBody.skip = 1;
        }

        const juBody: Record<string, unknown> = {
          where: junitWhere,
          include: JUNIT_RESULT_LIST_INCLUDE,
          // Matches @@index([repositoryCaseId, executedAt(sort: Desc)]).
          orderBy: [{ executedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (cursor.ju !== undefined) {
          juBody.cursor = { id: cursor.ju };
          juBody.skip = 1;
        }

        const [trRows, juRows] = await Promise.all([
          wantTestRun
            ? zenstack<RawRunResultRow[]>(
                "testRunResults",
                "findMany",
                trBody,
                deps.env,
              )
            : Promise.resolve([]),
          wantJunit
            ? zenstack<RawJunitResultRow[]>(
                "jUnitTestResult",
                "findMany",
                juBody,
                deps.env,
              )
            : Promise.resolve([]),
        ]);

        const page = mergeResultsPage(
          (trRows ?? []).map((r) => ({
            source: "TestRun" as const,
            id: r.id,
            executedAt: r.executedAt,
            raw: r,
          })),
          (juRows ?? []).map((r) => ({
            source: "JUnit" as const,
            id: r.id,
            executedAt: r.executedAt,
            raw: r,
          })),
          limit,
          cursor,
        );

        const items = page.items.map((entry) =>
          entry.source === "TestRun"
            ? mapRunResultRow(entry.raw as RawRunResultRow)
            : mapJunitResultRow(entry.raw as RawJunitResultRow),
        );

        const result = {
          items,
          hasNextPage: page.hasNextPage,
          nextCursor: page.nextCursor,
        };
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
