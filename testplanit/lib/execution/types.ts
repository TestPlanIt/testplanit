/**
 * Shared types for automated-execution dispatch (backlog 999.31).
 *
 * TestPlanIt never runs tests itself. An ExecutionTarget names a CI workflow
 * (or a signed webhook) and, when a run is executed, TestPlanIt mints an
 * execution record, starts the CI job with a handful of non-secret
 * parameters, and lets the job pull the plan and push results back through
 * the existing import path pinned with TESTPLANIT_RUN_ID.
 */

export type ExecutionProviderKind =
  "GITHUB_ACTIONS" | "GITLAB_CI" | "GENERIC_WEBHOOK";

export type TestRunExecutionStatusKind =
  | "PENDING"
  | "DISPATCHED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "DISPATCH_FAILED"
  | "TIMED_OUT"
  | "CANCELLED";

export const ACTIVE_EXECUTION_STATUSES: TestRunExecutionStatusKind[] = [
  "PENDING",
  "DISPATCHED",
  "RUNNING",
];

export const TERMINAL_EXECUTION_STATUSES: TestRunExecutionStatusKind[] = [
  "SUCCEEDED",
  "FAILED",
  "DISPATCH_FAILED",
  "TIMED_OUT",
  "CANCELLED",
];

/** The parameters every dispatch carries. Never secrets: CI inputs are visible to anyone who can read the repository. */
export const RESERVED_INPUT_KEYS = {
  runId: "TESTPLANIT_RUN_ID",
  executionId: "TESTPLANIT_EXECUTION_ID",
  projectId: "TESTPLANIT_PROJECT_ID",
  appUrl: "TESTPLANIT_URL",
  planUrl: "TESTPLANIT_PLAN_URL",
} as const;

export const RESERVED_INPUT_PREFIX = "TESTPLANIT_";

export interface DispatchRequest {
  runId: number;
  executionId: number;
  projectId: number;
  /** Git ref to run against; null lets the provider use its default branch. */
  ref: string | null;
  planUrl: string;
  appUrl: string;
  /** Fully merged inputs (reserved + static + per-execution). */
  inputs: Record<string, string>;
}

export interface DispatchResult {
  externalRunId?: string;
  externalUrl?: string;
  /** The ref the job was actually started on (default branch resolved). */
  ref?: string;
}

export type ExternalRunState =
  "queued" | "in_progress" | "completed" | "unknown";

export type ExternalRunConclusion =
  "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "other";

export interface ExternalStatus {
  state: ExternalRunState;
  conclusion?: ExternalRunConclusion;
  url?: string;
  /** Provider's raw status/conclusion, for the status chip. */
  raw?: string;
}

export interface DispatchCapability {
  ok: boolean;
  error?: string;
  warnings: string[];
  /** GitHub: `workflow_dispatch.inputs` keys parsed from the workflow file. */
  declaredInputs?: string[];
}

export interface WorkflowChoice {
  id: string;
  name: string;
  path: string;
}

/** Plan a CI job pulls after dispatch. */
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
