import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";

export interface RunCaseIterationsListDeps {
  env: EnvConfig;
}

const REDACTED = "••••••";

interface RawIteration {
  id: number;
  rowIndex: number;
  label: string | null;
  valuesJson: unknown;
  isCompleted: boolean;
  status: { id: number; name: string } | null;
}

interface RawRunCase {
  id: number;
  totalIterations: number;
  dataSetSnapshot: { parametersJson: unknown } | null;
}

/** Parameter names whose values are sensitive in this run's snapshot. */
function sensitiveNames(parametersJson: unknown): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(parametersJson)) return names;
  for (const p of parametersJson) {
    const param = p as { name?: unknown; sensitive?: unknown };
    if (param.sensitive === true && typeof param.name === "string") {
      names.add(param.name);
    }
  }
  return names;
}

export function registerRunCaseIterationsList(
  server: McpServer,
  deps: RunCaseIterationsListDeps,
): void {
  server.registerTool(
    "testplanit_test_run_case_iterations_list",
    {
      description:
        "List the iterations of a data-driven (parameterized) case in a run: one per data row, each with its id, rowIndex, label, parameter values (sensitive values redacted), status and completion. Record a result against one iteration by passing its id as `iterationId` to testplanit_test_run_results_create; a case with iterations takes results per iteration. Returns an empty list for a case without iterations.",
      inputSchema: {
        testRunCaseId: z
          .number()
          .int()
          .positive()
          .describe("ID of the TestRunCase (from testplanit_test_runs_cases_list)."),
      },
    },
    async (input) => {
      try {
        const runCase = await zenstack<RawRunCase | null>(
          "testRunCases",
          "findUnique",
          {
            where: { id: input.testRunCaseId },
            select: {
              id: true,
              totalIterations: true,
              dataSetSnapshot: { select: { parametersJson: true } },
            },
          },
          deps.env,
        );
        if (!runCase) {
          throw new TestPlanItHttpError(
            `TestRunCase ${input.testRunCaseId} not found.`,
            { statusCode: 404 },
          );
        }

        const rows = await zenstack<RawIteration[]>(
          "testRunCaseIteration",
          "findMany",
          {
            where: { testRunCaseId: input.testRunCaseId, isDeleted: false },
            orderBy: { rowIndex: "asc" },
            select: {
              id: true,
              rowIndex: true,
              label: true,
              valuesJson: true,
              isCompleted: true,
              status: { select: { id: true, name: true } },
            },
          },
          deps.env,
        );

        const hidden = sensitiveNames(runCase.dataSetSnapshot?.parametersJson);
        const items = (rows ?? []).map((row) => {
          const values =
            row.valuesJson && typeof row.valuesJson === "object"
              ? Object.fromEntries(
                  Object.entries(row.valuesJson as Record<string, unknown>).map(
                    ([name, value]) => [name, hidden.has(name) ? REDACTED : value],
                  ),
                )
              : {};
          return {
            id: row.id,
            rowIndex: row.rowIndex,
            label: row.label,
            values,
            status: row.status,
            isCompleted: row.isCompleted,
          };
        });

        const result = {
          testRunCaseId: runCase.id,
          totalIterations: runCase.totalIterations,
          items,
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
