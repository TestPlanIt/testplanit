import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import {
  JUNIT_RESULT_DETAIL_INCLUDE,
  RUN_RESULT_DETAIL_INCLUDE,
  mapJunitResultDetail,
  mapRunResultDetail,
  type RawJunitResultDetail,
  type RawRunResultDetail,
} from "../shared.js";

export interface RunResultsGetDeps {
  env: EnvConfig;
}

export function registerRunResultsGet(
  server: McpServer,
  deps: RunResultsGetDeps,
): void {
  server.registerTool(
    "testplanit_test_run_results_get",
    {
      description:
        "Fetch a single test run result. Pass the `source` from the results_list row: \"TestRun\" (default — manual TestRunResults) or \"JUnit\" (automated results ingested from JUnit/TestNG/xUnit/… reports; automated runs store results ONLY there — the two id spaces are independent). TestRun detail inlines step-level results (drill-down model — D7-09): stepText / expectedResultText (ProseMirror plain-text), status (stepStatus relation per R2 / schema.zmodel:2437), notes, evidence (Json as-is per D7-08), attachments, linked issues, plus customFields (resultFieldValues denormalized) and the parent testRunCase summary. JUnit detail carries junitType (PASSED/FAILURE/ERROR/SKIPPED), message, content (stack trace), systemOut/systemErr, time/assertions/file/line, suite + repositoryCase + testRun, and attachments; JUnit steps are stored per-CASE (no per-result FK) so they are not inlined. (per EXEC-05 / D7-07)",
      inputSchema: {
        // T-07-04 IDOR mitigation: positive integer only; non-int / non-positive
        // rejected at the zod boundary before zenstack is called. Host's
        // ZenStack @@allow policy is the row-level access boundary.
        resultId: z.number().int().positive(),
        source: z.enum(["TestRun", "JUnit"]).optional(),
      },
    },
    async (input) => {
      try {
        if (input.source === "JUnit") {
          const raw = await zenstack<RawJunitResultDetail | null>(
            "jUnitTestResult",
            "findUnique",
            {
              where: { id: input.resultId },
              include: JUNIT_RESULT_DETAIL_INCLUDE,
            },
            deps.env,
          );

          if (!raw) {
            // T-07-02 IDOR: policy-denied rows surface as not-found (same
            // contract as the TestRun branch below).
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `JUnit test result ${input.resultId} not found.`,
                },
              ],
            };
          }

          const detail = mapJunitResultDetail(raw);
          return {
            content: [{ type: "text", text: JSON.stringify(detail) }],
            structuredContent: detail as unknown as Record<string, unknown>,
          };
        }

        const raw = await zenstack<RawRunResultDetail | null>(
          "testRunResults",
          "findUnique",
          {
            where: { id: input.resultId },
            // RUN_RESULT_DETAIL_INCLUDE (07-01) ships the full step-level
            // shape: stepResults with stepStatus (R2), step text, attachments,
            // issues, plus top-level resultFieldValues / attachments / issues.
            // The constant is `as const satisfies Prisma.TestRunResultsInclude`
            // so a schema drift fails at typecheck (Phase 6 WR-09 invariant).
            include: RUN_RESULT_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          // T-07-02 IDOR: when the host's ZenStack @@allow policy denies the
          // row, findUnique returns null. Surface as a not-found rather than
          // a 403 to avoid leaking row-existence to unauthorized callers.
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Test run result ${input.resultId} not found. If this id came from a results_list row with source "JUnit", retry with source: "JUnit".`,
              },
            ],
          };
        }

        const detail = mapRunResultDetail(raw);
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
