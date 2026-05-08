import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import { TestPlanItHttpError } from "../../../http.js";
import {
  RUN_RESULT_DETAIL_INCLUDE,
  mapRunResultDetail,
  type RawRunResultDetail,
} from "../shared.js";

export interface RunResultsCreateDeps {
  env: EnvConfig;
}

const FETCH_TIMEOUT_MS = 10000;

function bearerHeaders(env: EnvConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${env.apiToken}`,
    "Content-Type": "application/json",
  };
}

async function submitResult(
  payload: {
    testRunId: number;
    testRunCaseId: number;
    statusId: number;
    notes: string | undefined;
    elapsed: number | null;
    attempt: number;
    testRunCaseVersion: number;
  },
  env: EnvConfig,
): Promise<{ result: { id: number } }> {
  const response = await fetch(
    `${env.apiUrl}/api/test-runs/submit-result`,
    {
      method: "POST",
      headers: bearerHeaders(env),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    let parsedMessage: string | undefined;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const errField = parsed?.error;
      if (typeof errField === "string") {
        parsedMessage = errField;
      } else if (errField && typeof errField === "object") {
        const msg = (errField as Record<string, unknown>).message;
        if (typeof msg === "string") parsedMessage = msg;
      }
    } catch {
      // non-JSON body
    }
    throw new TestPlanItHttpError(
      `HTTP ${response.status} from /api/test-runs/submit-result${parsedMessage ? `: ${parsedMessage}` : ""}`,
      { statusCode: response.status },
    );
  }
  return JSON.parse(text) as { result: { id: number } };
}

export function registerRunResultsCreate(
  server: McpServer,
  deps: RunResultsCreateDeps,
): void {
  server.registerTool(
    "testplanit_test_run_results_create",
    {
      description:
        "Submit a test result for a case in a run. Atomically creates the result record and updates the run case's current status. The attempt number is auto-incremented — no need to track it manually. Returns the full denormalized result (same shape as testplanit_test_run_results_get).",
      inputSchema: {
        testRunCaseId: z
          .number()
          .int()
          .positive()
          .describe("ID of the TestRunCase to submit a result for."),
        statusName: z
          .string()
          .min(1)
          .describe(
            "Status name (e.g. 'Passed', 'Failed', 'Blocked'). Must match a status enabled for the project.",
          ),
        notes: z
          .string()
          .optional()
          .describe("Plain-text notes for the result."),
        elapsed: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .optional()
          .describe("Elapsed time in milliseconds, or null."),
      },
    },
    async (input) => {
      try {
        // Fetch the test run case to get testRunId and projectId.
        const runCase = await zenstack<{
          id: number;
          testRunId: number;
          testRun: { projectId: number };
        } | null>(
          "testRunCases",
          "findUnique",
          {
            where: { id: input.testRunCaseId },
            select: {
              id: true,
              testRunId: true,
              testRun: { select: { projectId: true } },
            } satisfies Prisma.TestRunCasesSelect,
          },
          deps.env,
        );

        if (!runCase) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `TestRunCase ${input.testRunCaseId} not found.`,
              },
            ],
          };
        }

        // Resolve status by name scoped to the project.
        const statuses = await zenstack<Array<{ id: number }>>(
          "status",
          "findMany",
          {
            where: {
              name: input.statusName,
              isDeleted: false,
              isEnabled: true,
              projects: { some: { projectId: runCase.testRun.projectId } },
            } satisfies Prisma.StatusWhereInput,
            select: { id: true } satisfies Prisma.StatusSelect,
            take: 1,
          },
          deps.env,
        );

        if (!statuses || statuses.length === 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Status "${input.statusName}" not found for project ${runCase.testRun.projectId}. Use testplanit_test_runs_get to see available status names.`,
              },
            ],
          };
        }

        // Auto-increment attempt: count existing non-deleted results.
        const existingCount = await zenstack<number>(
          "testRunResults",
          "count",
          {
            where: {
              testRunCaseId: input.testRunCaseId,
              isDeleted: false,
            } satisfies Prisma.TestRunResultsWhereInput,
          },
          deps.env,
        );
        const attempt = (existingCount ?? 0) + 1;

        const { result } = await submitResult(
          {
            testRunId: runCase.testRunId,
            testRunCaseId: input.testRunCaseId,
            statusId: statuses[0].id,
            notes: input.notes,
            elapsed: input.elapsed ?? null,
            attempt,
            testRunCaseVersion: 1,
          },
          deps.env,
        );

        // Re-fetch the created result with the full denormalized shape.
        const raw = await zenstack<RawRunResultDetail | null>(
          "testRunResults",
          "findUnique",
          {
            where: { id: result.id },
            include: RUN_RESULT_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Result ${result.id} was created but could not be re-fetched.`,
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
