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
  /**
   * Custom result field values to persist atomically with the result. Each
   * `value` is the client-encoded field value (stringified for rich/object
   * types, a primitive string otherwise). The server enforces any required
   * fields on the case's template and rejects with REQUIRED_FIELDS_MISSING.
   */
  fieldValues?: Array<{ fieldId: number; value: unknown }>;
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

/**
 * True when the server rejected the submission because the outcome changed
 * relative to the prior attempt but no justification was supplied.
 */
export function isJustificationRequiredSubmitResultError(
  error: unknown
): error is SubmitResultError {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as SubmitResultError).code === "JUSTIFICATION_REQUIRED";
}

/**
 * True when the server rejected the submission because a required result
 * field was missing or empty.
 */
export function isRequiredFieldsMissingSubmitResultError(
  error: unknown
): error is SubmitResultError {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as SubmitResultError).code === "REQUIRED_FIELDS_MISSING";
}

/**
 * True when an edit was rejected because the result's in-place edit window
 * has closed (a correction must be a new attempt instead).
 */
export function isEditWindowExpiredResultError(
  error: unknown
): error is SubmitResultError {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as SubmitResultError).code === "EDIT_WINDOW_EXPIRED";
}

export interface EditTestRunResultInput {
  resultId: number;
  statusId: number;
  notes?: unknown;
  evidence?: unknown;
  elapsed?: number | null;
  testRunCaseVersion?: number;
  issueIds?: number[];
  /**
   * Custom result field values to persist atomically with the edit. Each
   * `value` is the client-encoded field value (stringified for rich/object
   * types, a primitive otherwise). The server enforces required fields and
   * rejects with REQUIRED_FIELDS_MISSING.
   */
  fieldValues?: Array<{ fieldId: number; value: unknown }>;
}

/**
 * Edits an existing manual result through the guarded server endpoint, which
 * enforces the edit window, required fields, and flip justification atomically
 * with the result + field-value writes (the same gates as recording a result).
 */
export async function editTestRunResult(
  input: EditTestRunResultInput
): Promise<SubmitTestRunResultResponse["result"]> {
  const response = await fetch("/api/test-runs/edit-result", {
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
      payload?.error || "Failed to edit test run result"
    ) as SubmitResultError;
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }

  return payload.result;
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
