export interface SubmitTestRunResultInput {
  testRunId: number;
  testRunCaseId: number;
  statusId: number;
  notes?: unknown;
  evidence?: unknown;
  elapsed?: number | null;
  attempt: number;
  testRunCaseVersion: number;
  issueIds?: number[];
  inProgressStateId?: number | null;
  /**
   * When set, the result is recorded against a specific iteration of a
   * parameterized test case. The server runs the worst-of rollup, updates
   * counters, and emits the iteration-scoped audit event.
   */
  iterationId?: number;
}

export interface SubmitTestRunResultResponse {
  result: {
    id: number;
  };
}

export type SubmitResultError = Error & {
  status?: number;
  code?: string;
};

export function isPermissionDeniedSubmitResultError(
  error: unknown
): error is SubmitResultError {
  if (!error || typeof error !== "object") {
    return false;
  }

  const submitError = error as SubmitResultError;

  return submitError.status === 403 || submitError.code === "PERMISSION_DENIED";
}

export async function submitTestRunResult(
  input: SubmitTestRunResultInput
): Promise<SubmitTestRunResultResponse["result"]> {
  const response = await fetch("/api/test-runs/submit-result", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    code?: string;
    result?: SubmitTestRunResultResponse["result"];
  } | null;

  if (!response.ok || !payload?.result) {
    const error = new Error(
      payload?.error || "Failed to submit test run result"
    ) as SubmitResultError;
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }

  return payload.result;
}
