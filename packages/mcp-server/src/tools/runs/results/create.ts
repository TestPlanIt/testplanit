import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  StatusSelect,
  StatusWhereInput,
  TemplateResultAssignmentSelect,
  TestRunCasesSelect,
  TestRunResultsWhereInput,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import { TestPlanItHttpError } from "../../../http.js";
import { plainTextToProseMirrorDoc } from "../../cases/shared.js";
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
    notes: unknown;
    elapsed: number | null;
    attempt: number;
    testRunCaseVersion: number;
    iterationId?: number;
    issueIds?: number[];
    inProgressStateId: number | null;
    fieldValues: Array<{ fieldId: number; value: string }> | undefined;
  },
  env: EnvConfig
): Promise<{ result: { id: number } }> {
  const response = await fetch(`${env.apiUrl}/api/test-runs/submit-result`, {
    method: "POST",
    headers: bearerHeaders(env),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
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
      { statusCode: response.status }
    );
  }
  return JSON.parse(text) as { result: { id: number } };
}

export function registerRunResultsCreate(
  server: McpServer,
  deps: RunResultsCreateDeps
): void {
  server.registerTool(
    "testplanit_test_run_results_create",
    {
      description:
        "Submit a test result for a case in a run. Atomically creates the result record and updates the run case's current status. For a data-driven case, pass the iterationId of the data row the result is for. The attempt number is auto-incremented — no need to track it manually. Optional `fieldValues` records custom Result Field entries alongside the result; pass either the field's display name or its system name. The server rejects the submission if the case's template marks any Result Field required and `fieldValues` does not supply each one. Returns the full denormalized result (same shape as testplanit_test_run_results_get).",
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
            "Status name (e.g. 'Passed', 'Failed', 'Blocked'). Must match a status enabled for the project."
          ),
        notes: z
          .string()
          .optional()
          .describe(
            "Plain-text notes for the result. Stored as a rich-text document (each line becomes a paragraph) so they show in the Test Result History panel."
          ),
        elapsed: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .optional()
          .describe(
            "Elapsed execution time in SECONDS (e.g. 95 for 1 min 35 s), or null. Stored as-is; the UI, forecasts and time tracking all read seconds."
          ),
        issueIds: z
          .array(z.number().int().positive())
          .max(50)
          .optional()
          .describe(
            "Issue IDs to link to the result. A project that requires an issue on failure refuses a failed result without one; resolve a tracker key to an id with testplanit_issues_resolve.",
          ),
        iterationId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "For a data-driven case: the iteration (data row) this result is for. Required when the case has iterations — list them with testplanit_test_run_case_iterations_list.",
          ),
        fieldValues: z
          .array(
            z.object({
              name: z
                .string()
                .min(1)
                .describe(
                  "Display name (case-insensitive) or system name of a Result Field assigned to the case's template."
                ),
              value: z
                .union([z.string(), z.number(), z.boolean()])
                .describe(
                  "Value to record. Strings/numbers/booleans are coerced to strings and stored as-is — pass the option's name for dropdowns."
                ),
            })
          )
          .optional()
          .describe(
            "Custom Result Field values to record alongside the result. Required when the case's template marks any Result Field required."
          ),
      },
    },
    async (input) => {
      try {
        // Fetch the test run case to get testRunId, projectId, templateId
        // (needed to resolve fieldValues by name) and the case's current
        // version, which the result records as the version executed — the
        // same value the web UI sends.
        const runCase = await zenstack<{
          id: number;
          testRunId: number;
          testRun: { projectId: number };
          totalIterations: number;
          repositoryCase: { templateId: number | null; currentVersion: number };
        } | null>(
          "testRunCases",
          "findUnique",
          {
            where: { id: input.testRunCaseId },
            select: {
              id: true,
              testRunId: true,
              totalIterations: true,
              testRun: { select: { projectId: true } },
              repositoryCase: {
                select: { templateId: true, currentVersion: true },
              },
            } satisfies TestRunCasesSelect,
          },
          deps.env
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

        // A data-driven case takes one result per data row. A case-level
        // result would overwrite the case's status and bypass the per-row
        // rollup, so it needs the iteration it is for.
        if (input.iterationId == null && runCase.totalIterations > 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `TestRunCase ${input.testRunCaseId} is data-driven (${runCase.totalIterations} iterations). Pass iterationId; list them with testplanit_test_run_case_iterations_list.`,
              },
            ],
          };
        }
        if (input.iterationId != null) {
          const iteration = await zenstack<{ id: number } | null>(
            "testRunCaseIteration",
            "findFirst",
            {
              where: {
                id: input.iterationId,
                testRunCaseId: input.testRunCaseId,
                isDeleted: false,
              },
              select: { id: true },
            },
            deps.env,
          );
          if (!iteration) {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Iteration ${input.iterationId} does not belong to TestRunCase ${input.testRunCaseId}.`,
                },
              ],
            };
          }
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
              // The statuses a tester can pick for a run result in the web UI.
              scope: { some: { scope: { name: "Test Run" } } },
            } satisfies StatusWhereInput,
            select: { id: true } satisfies StatusSelect,
            take: 1,
          },
          deps.env
        );

        if (!statuses || statuses.length === 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Status "${input.statusName}" is not a test-run status in project ${runCase.testRun.projectId}. Use testplanit_test_runs_get to see available status names.`,
              },
            ],
          };
        }

        // Resolve fieldValues input — map field names to numeric fieldIds via
        // the case's template result-field assignments. The server enforces
        // REQUIRED_FIELDS_MISSING; this step just translates names → IDs so the
        // agent doesn't need to know the numeric IDs.
        let serverFieldValues:
          | Array<{ fieldId: number; value: string }>
          | undefined;

        if (input.fieldValues && input.fieldValues.length > 0) {
          if (runCase.repositoryCase.templateId == null) {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: "Cannot resolve fieldValues: the case has no template. Remove fieldValues, or assign a template to the case.",
                },
              ],
            };
          }

          const assignments = await zenstack<
            Array<{
              resultField: {
                id: number;
                displayName: string;
                systemName: string;
              };
            }>
          >(
            "templateResultAssignment",
            "findMany",
            {
              where: {
                templateId: runCase.repositoryCase.templateId,
                resultField: { isEnabled: true, isDeleted: false },
              },
              select: {
                resultField: {
                  select: {
                    id: true,
                    displayName: true,
                    systemName: true,
                  },
                },
              } satisfies TemplateResultAssignmentSelect,
            },
            deps.env
          );

          const byDisplay = new Map<string, number>();
          const bySystem = new Map<string, number>();
          for (const a of assignments ?? []) {
            byDisplay.set(
              a.resultField.displayName.toLowerCase(),
              a.resultField.id
            );
            bySystem.set(a.resultField.systemName, a.resultField.id);
          }

          const unresolved: string[] = [];
          const resolved: Array<{ fieldId: number; value: string }> = [];
          for (const fv of input.fieldValues) {
            const id =
              byDisplay.get(fv.name.toLowerCase()) ?? bySystem.get(fv.name);
            if (id === undefined) {
              unresolved.push(fv.name);
              continue;
            }
            resolved.push({ fieldId: id, value: String(fv.value) });
          }

          if (unresolved.length > 0) {
            const available =
              (assignments ?? [])
                .map((a) => a.resultField.displayName)
                .join(", ") || "(none assigned to this template)";
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Unknown result field name(s): ${unresolved.join(", ")}. Available fields on this template: ${available}.`,
                },
              ],
            };
          }

          serverFieldValues = resolved;
        }

        // Auto-increment attempt: count existing non-deleted results.
        const existingCount = await zenstack<number>(
          "testRunResults",
          "count",
          {
            where: {
              testRunCaseId: input.testRunCaseId,
              isDeleted: false,
              // Attempts count per data row for a data-driven case.
              ...(input.iterationId != null
                ? { iterationId: input.iterationId }
                : {}),
            } satisfies TestRunResultsWhereInput,
          },
          deps.env
        );
        const attempt = (existingCount ?? 0) + 1;

        // The web UI sends the project's first In Progress run state, so the
        // run leaves its initial state with its first result.
        const inProgress = await zenstack<{ id: number } | null>(
          "workflows",
          "findFirst",
          {
            where: {
              projects: { some: { projectId: runCase.testRun.projectId } },
              scope: "RUNS",
              workflowType: "IN_PROGRESS",
              isEnabled: true,
              isDeleted: false,
            },
            orderBy: { order: "asc" },
            select: { id: true },
          },
          deps.env
        );

        const { result } = await submitResult(
          {
            testRunId: runCase.testRunId,
            testRunCaseId: input.testRunCaseId,
            statusId: statuses[0].id,
            notes: plainTextToProseMirrorDoc(input.notes),
            elapsed: input.elapsed ?? null,
            attempt,
            testRunCaseVersion: runCase.repositoryCase.currentVersion,
            ...(input.iterationId != null
              ? { iterationId: input.iterationId }
              : {}),
            ...(input.issueIds ? { issueIds: input.issueIds } : {}),
            inProgressStateId: inProgress?.id ?? null,
            fieldValues: serverFieldValues,
          },
          deps.env
        );

        // Re-fetch the created result with the full denormalized shape.
        const raw = await zenstack<RawRunResultDetail | null>(
          "testRunResults",
          "findUnique",
          {
            where: { id: result.id },
            include: RUN_RESULT_DETAIL_INCLUDE,
          },
          deps.env
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
    }
  );
}
