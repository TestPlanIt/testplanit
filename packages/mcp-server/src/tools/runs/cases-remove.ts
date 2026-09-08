import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  TestRunCasesCountArgs,
  TestRunCasesUpdateManyArgs,
  TestRunCaseIterationUpdateManyArgs,
  TestRunResultsUpdateManyArgs,
  TestRunStepResultsUpdateManyArgs,
  TestRunsSelect,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface RunsCasesRemoveDeps {
  env: EnvConfig;
}

const MAX_CASE_IDS = 250;

export function registerRunsCasesRemove(
  server: McpServer,
  deps: RunsCasesRemoveDeps,
): void {
  server.registerTool(
    "testplanit_runs_cases_remove",
    {
      description:
        "Remove test cases from a run (the counterpart of testplanit_runs_cases_add — takes the same repository case IDs, not TestRunCase row IDs). Soft-deletes the run's junction rows AND their recorded results, step results, and iterations, matching the web UI's remove-cases flow; the repository cases themselves are untouched. Re-adding a removed case via testplanit_runs_cases_add restores it. Fails when the run is completed or composition-locked (execution started) — the case set is frozen. Returns the number of cases removed and the run's remaining case count.",
      inputSchema: {
        runId: z
          .number()
          .int()
          .positive()
          .describe("ID of the run to remove cases from."),
        caseIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(MAX_CASE_IDS)
          .describe(
            `Repository case IDs to remove (1–${MAX_CASE_IDS}) — the repositoryCase.id on run case rows.`,
          ),
      },
    },
    async (input) => {
      try {
        // Pre-check the run's locks so the agent gets a clear reason instead
        // of a policy-denial error (the ZenStack rules enforce the same
        // freezes server-side regardless).
        const run = await zenstack<{
          id: number;
          isCompleted: boolean;
          compositionLockedAt: string | Date | null;
        } | null>(
          "testRuns",
          "findUnique",
          {
            where: { id: input.runId },
            select: {
              id: true,
              isCompleted: true,
              compositionLockedAt: true,
            } satisfies TestRunsSelect,
          },
          deps.env,
        );
        if (!run) {
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
        if (run.isCompleted) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Test run ${input.runId} is completed — its case set is frozen and cases cannot be removed.`,
              },
            ],
          };
        }
        if (run.compositionLockedAt !== null) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Test run ${input.runId} is composition-locked (execution has started) — cases cannot be removed.`,
              },
            ],
          };
        }

        // Cascade order mirrors the web UI's remove-cases flow: step results,
        // then results, then iterations, then the junction rows themselves.
        const caseScope = {
          testRunId: input.runId,
          repositoryCaseId: { in: input.caseIds },
        };

        await zenstack(
          "testRunStepResults",
          "updateMany",
          {
            where: { testRunResult: { testRunCase: caseScope } },
            data: { isDeleted: true },
          } satisfies TestRunStepResultsUpdateManyArgs,
          deps.env,
        );
        await zenstack(
          "testRunResults",
          "updateMany",
          {
            where: { testRunCase: caseScope },
            data: { isDeleted: true },
          } satisfies TestRunResultsUpdateManyArgs,
          deps.env,
        );
        await zenstack(
          "testRunCaseIteration",
          "updateMany",
          {
            where: { testRunCase: caseScope },
            data: { isDeleted: true },
          } satisfies TestRunCaseIterationUpdateManyArgs,
          deps.env,
        );

        const removedResult = await zenstack<{ count: number }>(
          "testRunCases",
          "updateMany",
          {
            where: { ...caseScope, isDeleted: false },
            data: { isDeleted: true },
          } satisfies TestRunCasesUpdateManyArgs,
          deps.env,
        );

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
          removed: removedResult?.count ?? 0,
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
