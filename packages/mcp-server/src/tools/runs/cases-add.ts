import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
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
        "Add repository test cases to an existing test run. Cases are appended after any existing run cases (order preserved). Duplicate case IDs are silently skipped by the database. Returns a confirmation with the number of cases added and the updated total.",
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
          } satisfies Prisma.TestRunCasesAggregateArgs,
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

        // Return the updated total (R1: no isDeleted on TestRunCases).
        const total = await zenstack<number>(
          "testRunCases",
          "count",
          {
            where: { testRunId: input.runId },
          } satisfies Prisma.TestRunCasesCountArgs,
          deps.env,
        );

        const result = {
          runId: input.runId,
          requested: input.caseIds.length,
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
