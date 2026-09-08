import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  TestRunsInclude,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  RUN_ROW_INCLUDE,
  runDetailTestCaseInclude,
  computeStatusRollup,
  extractJunitStatusNames,
  extractStatusNames,
  isAutomatedRunType,
  mapRunRow,
  mapRunDetailTestCase,
  type RawRunRow,
  type RawRunDetailTestCase,
} from "./shared.js";

export interface RunsGetDeps {
  env: EnvConfig;
}

const TESTCASES_INLINE_LIMIT = 50;

/**
 * Combined include for `testRuns.findUnique` — the run header (RUN_ROW_INCLUDE
 * shape) plus the first 50 testCases inline (each carrying repositoryCase /
 * assignedTo / status / latest result via runDetailTestCaseInclude — a
 * function because the JUnit half of latestResult is scoped to this runId).
 *
 * Cases beyond the 50-cap are paginated via `testplanit_test_runs_cases_list`.
 * The include shape is `as const satisfies TestRunsInclude` — adding
 * an unknown column produces TS2353 at compile time (Phase 6 WR-09).
 */
export function runDetailInclude(runId: number) {
  return {
    ...RUN_ROW_INCLUDE,
    testCases: {
      // R1 (revised): exclude soft-removed run cases.
      where: { isDeleted: false },
      // BL-04 deterministic ordering carried into the inline include.
      orderBy: [{ order: "asc" }, { id: "asc" }],
      take: TESTCASES_INLINE_LIMIT,
      include: runDetailTestCaseInclude(runId),
    },
  } as const satisfies TestRunsInclude;
}

export function registerRunsGet(
  server: McpServer,
  deps: RunsGetDeps,
): void {
  server.registerTool(
    "testplanit_test_runs_get",
    {
      description:
        "Fetch a single test run with denormalized header (state/createdBy/configuration/milestone/tags/issues/testRunType), status-count rollup (counts SUM to total per R3), and the first 50 test cases inline (each with latestResult, a union of manual TestRunResults and automated JUnit results discriminated by `source`). Rollup source depends on testRunType: REGULAR runs count TestRunCases by execution status (`untested` = cases with no result, `total` = case count); automated runs (testRunType != REGULAR: JUNIT/TESTNG/XUNIT/NUNIT/MSTEST/MOCHA/CUCUMBER) count imported JUnit result ROWS by status — attempts, so retries count once per row and `total` is the attempt count, matching the web UI. Automated results live in JUnit suite tables — list them via testplanit_test_run_results_list({runId}); rows come back with source \"JUnit\". Inline testCases[].status is the junction row's status when set, falling back to latestResult.status (the automated-run junction rows never carry their own status). When the run has more than 50 cases, `testCasesNextCursor` is set; call testplanit_test_runs_cases_list with that cursor to fetch the rest. (per EXEC-02 / D7-04 / D7-05)",
      inputSchema: {
        runId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const raw = await zenstack<
          | (RawRunRow & { testCases: RawRunDetailTestCase[] })
          | null
        >(
          "testRuns",
          "findUnique",
          {
            where: { id: input.runId },
            include: runDetailInclude(input.runId),
          },
          deps.env,
        );

        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Test run ${input.runId} not found.`,
              },
            ],
          };
        }

        // R3 — total summed from groupBy results in computeStatusRollup;
        // never derived from a separate count call. Source splits on
        // testRunType: REGULAR counts TestRunCases.statusId; automated runs
        // count JUnitTestResult rows (attempts — web-UI semantics; their
        // TestRunCases junction rows never carry a statusId).
        const isAutomated = isAutomatedRunType(raw.testRunType);
        const { groups, nameById } = isAutomated
          ? await extractJunitStatusNames(input.runId, deps.env)
          : await extractStatusNames(input.runId, deps.env);
        const rollup = computeStatusRollup(groups, nameById);

        const testCases = (raw.testCases ?? []).map(mapRunDetailTestCase);
        // D7-05: if the run has more cases than fit inline AND the inline
        // page hit its cap, surface the last inline id as the cursor for
        // testplanit_test_runs_cases_list. For automated runs rollup.total
        // counts result attempts, not cases, so the cap check stands alone —
        // an exactly-full page yields a cursor whose next page may be empty
        // (harmless; the alternative is an extra count call per get).
        const inlinePageFull = testCases.length === TESTCASES_INLINE_LIMIT;
        const testCasesNextCursor =
          inlinePageFull && (isAutomated || rollup.total > TESTCASES_INLINE_LIMIT)
            ? testCases[testCases.length - 1].id
            : null;

        const detail = {
          ...mapRunRow(raw),
          statusCounts: rollup.statusCounts,
          untested: rollup.untested,
          total: rollup.total,
          testCases,
          testCasesNextCursor,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(detail) }],
          structuredContent: detail as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}
