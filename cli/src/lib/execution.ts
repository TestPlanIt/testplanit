/**
 * Automated-execution helpers: the plan a CI job pulls after TestPlanIt
 * dispatches it, finishing an execution explicitly, and completing a run.
 *
 * The CLI cannot depend on @testplanit/api (its publish path does not
 * resolve the workspace protocol), so the few host calls it needs are
 * duplicated here in the same shape as lib/api.ts.
 */

import { getUrl, getToken } from "./config.js";
import type { APIError } from "../types.js";

export interface AutomationPlanCase {
  id: number;
  title: string;
  className: string | null;
  source: string;
  automated: boolean;
  selector: {
    name: string;
    className: string | null;
    fullName: string;
    idTokens: { brackets: string; c: string; tc: string };
  };
  tags: string[];
}

export interface AutomationPlan {
  runId: number;
  projectId: number;
  executionId: number | null;
  ref: string | null;
  run: {
    name: string;
    testRunType: string;
    configuration: string | null;
    milestone: string | null;
  };
  generatedAt: string;
  cases: AutomationPlanCase[];
  totals: { cases: number };
}

export type PlanFormat = "json" | "lines";
export type SelectorField =
  | "selector"
  | "fullName"
  | "title"
  | "className"
  | "id";

export const PLAN_FORMATS: readonly PlanFormat[] = ["json", "lines"];
export const SELECTOR_FIELDS: readonly SelectorField[] = [
  "selector",
  "fullName",
  "title",
  "className",
  "id",
];

export type ExecutionConclusion = "success" | "failure" | "cancelled";
export const EXECUTION_CONCLUSIONS: readonly ExecutionConclusion[] = [
  "success",
  "failure",
  "cancelled",
];

function requireConfig(): { url: string; token: string } {
  const url = getUrl();
  const token = getToken();
  if (!url) throw new Error("TestPlanIt URL is not configured");
  if (!token) throw new Error("API token is not configured");
  return { url, token };
}

async function readError(response: Response): Promise<string> {
  let message = `HTTP ${response.status}: ${response.statusText}`;
  try {
    const body = (await response.json()) as APIError;
    if (body.error) message = body.error;
  } catch {
    // non-JSON body
  }
  return message;
}

async function hostJson<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {}
): Promise<T> {
  const { url, token } = requireConfig();
  const target = new URL(path, url);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) target.searchParams.set(key, value);
  }
  const response = await fetch(target.toString(), {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(init.body ? { body: init.body } : {}),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

/** GET /api/test-runs/{runId}/automation-plan[?executionId=] */
export async function getAutomationPlan(
  runId: number,
  executionId?: number
): Promise<AutomationPlan> {
  return hostJson<AutomationPlan>(`/api/test-runs/${runId}/automation-plan`, {
    query: executionId ? { executionId: String(executionId) } : {},
  });
}

/** POST /api/test-runs/{runId}/executions/{executionId}/finish */
export async function finishExecution(
  runId: number,
  executionId: number,
  conclusion: ExecutionConclusion,
  message?: string
): Promise<{ id: number; status: string }> {
  return hostJson(`/api/test-runs/${runId}/executions/${executionId}/finish`, {
    method: "POST",
    body: JSON.stringify({ conclusion, ...(message ? { message } : {}) }),
  });
}

export const TEST_RUN_TYPES = [
  "REGULAR",
  "JUNIT",
  "TESTNG",
  "XUNIT",
  "NUNIT",
  "MSTEST",
  "MOCHA",
  "CUCUMBER",
] as const;
export type CreatableTestRunType = (typeof TEST_RUN_TYPES)[number];

export interface CreateTestRunInput {
  projectId: number;
  name: string;
  testRunType?: CreatableTestRunType;
  configId?: number;
  milestoneId?: number;
  tagIds?: number[];
}

/**
 * Create a run in the project's first IN_PROGRESS run state (any run state
 * when none is marked in progress). Mirrors `create-run` in @testplanit/api,
 * for pipelines that create one run up front and let every shard, machine and
 * retry attach to it through TESTPLANIT_RUN_ID.
 */
export async function createTestRun(
  input: CreateTestRunInput
): Promise<{ id: number; name: string }> {
  const findState = (workflowType?: string) =>
    hostJson<{ data?: Array<{ id: number }> }>(
      `/api/model/workflows/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            isEnabled: true,
            isDeleted: false,
            scope: "RUNS",
            ...(workflowType ? { workflowType } : {}),
            projects: { some: { projectId: input.projectId } },
          },
          orderBy: { order: "asc" },
          take: 1,
        })
      )}`
    );
  const stateId =
    (await findState("IN_PROGRESS")).data?.[0]?.id ??
    (await findState()).data?.[0]?.id;
  if (!stateId) {
    throw new Error("No workflow state found for test runs in this project");
  }
  const data: Record<string, unknown> = {
    name: input.name,
    testRunType: input.testRunType ?? "REGULAR",
    project: { connect: { id: input.projectId } },
    state: { connect: { id: stateId } },
  };
  if (input.configId) data.configuration = { connect: { id: input.configId } };
  if (input.milestoneId) data.milestone = { connect: { id: input.milestoneId } };
  if (input.tagIds?.length) {
    data.tags = { connect: input.tagIds.map((id) => ({ id })) };
  }
  const created = await hostJson<{ data?: { id: number; name: string } }>(
    `/api/model/testRuns/create`,
    { method: "POST", body: JSON.stringify({ data }) }
  );
  if (!created.data) throw new Error("The test run could not be created");
  return created.data;
}

/**
 * Mark a run complete: isCompleted = true, moved to the project's first DONE
 * run state when one exists. Mirrors `complete-run` in @testplanit/api.
 */
export async function completeTestRun(
  runId: number,
  projectId?: number
): Promise<{ id: number; isCompleted: boolean }> {
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const run = await hostJson<{ data?: { projectId: number } }>(
      `/api/model/testRuns/findUnique?q=${encodeURIComponent(
        JSON.stringify({ where: { id: runId }, select: { projectId: true } })
      )}`
    );
    if (!run.data) throw new Error(`Test run ${runId} not found`);
    resolvedProjectId = run.data.projectId;
  }
  const states = await hostJson<{ data?: Array<{ id: number }> }>(
    `/api/model/workflows/findMany?q=${encodeURIComponent(
      JSON.stringify({
        where: {
          isEnabled: true,
          isDeleted: false,
          scope: "RUNS",
          workflowType: "DONE",
          projects: { some: { projectId: resolvedProjectId } },
        },
        orderBy: { order: "asc" },
        take: 1,
      })
    )}`
  );
  const doneStateId = states.data?.[0]?.id;
  const updated = await hostJson<{
    data?: { id: number; isCompleted: boolean };
  }>(`/api/model/testRuns/update`, {
    method: "PATCH",
    body: JSON.stringify({
      where: { id: runId },
      data: {
        isCompleted: true,
        completedAt: new Date().toISOString(),
        ...(doneStateId ? { stateId: doneStateId } : {}),
      },
    }),
  });
  if (!updated.data) throw new Error(`Test run ${runId} could not be completed`);
  return updated.data;
}

export function selectorValue(
  testCase: AutomationPlanCase,
  field: SelectorField
): string {
  switch (field) {
    case "id":
      return String(testCase.id);
    case "title":
      return testCase.title;
    case "className":
      return testCase.className ?? "";
    case "fullName":
      return testCase.selector.fullName;
    case "selector":
    default:
      return testCase.selector.fullName || testCase.title;
  }
}

/**
 * `json` prints the plan verbatim; `lines` prints one selector per case so a
 * shell shim can feed it to whatever runner it drives. Framework-specific
 * filter syntax (`--grep`, `-k`, `--tests`) is the shim's job, not the CLI's.
 */
export function formatPlan(
  plan: AutomationPlan,
  format: PlanFormat,
  field: SelectorField = "selector"
): string {
  if (format === "json") return JSON.stringify(plan, null, 2);
  return plan.cases
    .map((c) => selectorValue(c, field))
    .filter((v) => v.length > 0)
    .join("\n");
}

export function parseEnvId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
