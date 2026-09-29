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
import { generateRunIterations } from "./shared.js";

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
        "Add repository test cases to an existing test run. Cases are appended after any existing run cases (order preserved). Case IDs already in the run are silently skipped; a case previously removed from the run is restored at its former position, untested (its earlier results stay removed). Data-driven cases get their iterations, as in the web UI. Returns the number of cases requested and restored, the updated total, and `iterations` (whether they were generated, and how many).",
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
        // Restored rows keep their former order position but come back
        // untested: their results were removed with them, so the old status
        // and iteration counts would describe results that no longer count.
        const removed = await zenstack<Array<{ id: number }>>(
          "testRunCases",
          "findMany",
          {
            where: {
              testRunId: input.runId,
              repositoryCaseId: { in: input.caseIds },
              isDeleted: true,
            },
            select: { id: true },
          },
          deps.env,
        );
        const removedIds = (removed ?? []).map((r) => r.id);
        let restored: { count: number } = { count: 0 };
        if (removedIds.length > 0) {
          restored = await zenstack<{ count: number }>(
            "testRunCases",
            "updateMany",
            {
              where: { id: { in: removedIds } },
              data: {
                isDeleted: false,
                statusId: null,
                isCompleted: false,
                startedAt: null,
                completedAt: null,
                elapsed: null,
                passedIterations: 0,
                failedIterations: 0,
                skippedIterations: 0,
              },
            } satisfies TestRunCasesUpdateManyArgs,
            deps.env,
          );
          // Their iterations were removed with them; bring those back
          // untested too.
          await zenstack(
            "testRunCaseIteration",
            "updateMany",
            {
              where: { testRunCaseId: { in: removedIds }, isDeleted: true },
              data: {
                isDeleted: false,
                statusId: null,
                isCompleted: false,
                startedAt: null,
                completedAt: null,
                elapsed: null,
              },
            },
            deps.env,
          );
        }

        // Return the updated total of active (non-removed) run cases.
        const total = await zenstack<number>(
          "testRunCases",
          "count",
          {
            where: { testRunId: input.runId, isDeleted: false },
          } satisfies TestRunCasesCountArgs,
          deps.env,
        );

        const iterations = await generateRunIterations(input.runId, deps.env);

        const result = {
          runId: input.runId,
          requested: input.caseIds.length,
          restored: restored?.count ?? 0,
          total: total ?? 0,
          iterations,
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
