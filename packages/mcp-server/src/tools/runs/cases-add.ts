import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  TestRunCasesAggregateArgs,
  TestRunCasesCountArgs,
  TestRunCasesUpdateManyArgs,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface RunsCasesAddDeps {
  env: EnvConfig;
}

const MAX_CASE_IDS = 250;

export function registerRunsCasesAdd(
  server: McpServer,
  deps: RunsCasesAddDeps,
): void {
  server.registerTool(
    "testplanit_runs_cases_add",
    {
      description:
        "Add repository test cases to an existing test run. Cases are appended after any existing run cases (order preserved). Case IDs already in the run are silently skipped; a case previously removed from the run is restored (at its former position, with its prior results still soft-deleted). Returns a confirmation with the number of cases requested, restored, and the updated total.",
      inputSchema: {
        runId: z
          .number()
          .int()
          .positive()
          .describe("ID of the run to add cases to."),
        caseIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(MAX_CASE_IDS)
          .describe(
            `Repository case IDs to add (1–${MAX_CASE_IDS}). Order is preserved.`,
          ),
      },
    },
    async (input) => {
      try {
        // Get the current max order for this run so new cases are appended.
        const agg = await zenstack<{ _max: { order: number | null } }>(
          "testRunCases",
          "aggregate",
          {
            where: { testRunId: input.runId },
            _max: { order: true },
          } satisfies TestRunCasesAggregateArgs,
          deps.env,
        );
        const baseOrder = (agg?._max?.order ?? 0) + 1;

        await zenstack(
          "testRunCases",
          "createMany",
          {
            data: input.caseIds.map((caseId, i) => ({
              testRunId: input.runId,
              repositoryCaseId: caseId,
              order: baseOrder + i,
            })),
            skipDuplicates: true,
          },
          deps.env,
        );

        // Restore any of the requested cases that were previously removed
        // from the run — createMany's skipDuplicates skips their existing
        // (soft-deleted) rows, which would otherwise leave them removed.
        // Restored rows keep their former order position.
        const restored = await zenstack<{ count: number }>(
          "testRunCases",
          "updateMany",
          {
            where: {
              testRunId: input.runId,
              repositoryCaseId: { in: input.caseIds },
              isDeleted: true,
            },
            data: { isDeleted: false },
          } satisfies TestRunCasesUpdateManyArgs,
          deps.env,
        );

        // Return the updated total of active (non-removed) run cases.
        const total = await zenstack<number>(
          "testRunCases",
          "count",
          {
            where: { testRunId: input.runId, isDeleted: false },
          } satisfies TestRunCasesCountArgs,
          deps.env,
        );

        const result = {
          runId: input.runId,
          requested: input.caseIds.length,
          restored: restored?.count ?? 0,
          total: total ?? 0,
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
