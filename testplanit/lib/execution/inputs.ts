import {
  RESERVED_INPUT_KEYS,
  RESERVED_INPUT_PREFIX,
  type DispatchRequest,
} from "./types";

/**
 * Limits chosen to stay under the tightest provider cap: GitHub allows 25
 * workflow_dispatch inputs and 65,535 characters in total. Five keys are
 * reserved for TestPlanIt, which leaves 20 for the target and the caller.
 */
export const MAX_CUSTOM_INPUT_KEYS = 20;
export const MAX_INPUT_VALUE_LENGTH = 1000;
export const MAX_INPUTS_TOTAL_BYTES = 60 * 1024;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type InputValidationError =
  | { code: "INVALID_KEY"; key: string }
  | { code: "RESERVED_KEY"; key: string }
  | { code: "VALUE_TOO_LONG"; key: string }
  | { code: "TOO_MANY_KEYS"; count: number }
  | { code: "TOO_LARGE"; bytes: number }
  | { code: "NOT_AN_OBJECT" };

/**
 * Validate user-supplied inputs (a target's static inputs or a per-execution
 * override). Returns the first problem found, or null when the map is usable.
 */
export function validateCustomInputs(
  raw: unknown
): InputValidationError | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { code: "NOT_AN_OBJECT" };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_INPUT_KEYS) {
    return { code: "TOO_MANY_KEYS", count: entries.length };
  }
  let bytes = 0;
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) return { code: "INVALID_KEY", key };
    if (key.toUpperCase().startsWith(RESERVED_INPUT_PREFIX)) {
      return { code: "RESERVED_KEY", key };
    }
    const str = value == null ? "" : String(value);
    if (str.length > MAX_INPUT_VALUE_LENGTH) {
      return { code: "VALUE_TOO_LONG", key };
    }
    bytes += Buffer.byteLength(key) + Buffer.byteLength(str);
  }
  if (bytes > MAX_INPUTS_TOTAL_BYTES) return { code: "TOO_LARGE", bytes };
  return null;
}

/** Coerce a validated map to strings (CI providers only accept strings). */
export function normalizeInputs(raw: unknown): Record<string, string> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = value == null ? "" : String(value);
  }
  return out;
}

/**
 * Merge the three input layers. Reserved keys always win so a target can
 * never override the run it is being asked to execute.
 */
export function buildDispatchInputs(
  req: Pick<
    DispatchRequest,
    "runId" | "executionId" | "projectId" | "appUrl" | "planUrl"
  >,
  staticInputs: Record<string, string>,
  perExecutionInputs: Record<string, string>
): Record<string, string> {
  return {
    ...staticInputs,
    ...perExecutionInputs,
    [RESERVED_INPUT_KEYS.runId]: String(req.runId),
    [RESERVED_INPUT_KEYS.executionId]: String(req.executionId),
    [RESERVED_INPUT_KEYS.projectId]: String(req.projectId),
    [RESERVED_INPUT_KEYS.appUrl]: req.appUrl,
    [RESERVED_INPUT_KEYS.planUrl]: req.planUrl,
  };
}

export function describeInputError(err: InputValidationError): string {
  switch (err.code) {
    case "INVALID_KEY":
      return `Input name "${err.key}" must match ${KEY_PATTERN.source}`;
    case "RESERVED_KEY":
      return `Input name "${err.key}" is reserved (TESTPLANIT_* keys are set by TestPlanIt)`;
    case "VALUE_TOO_LONG":
      return `Input "${err.key}" exceeds ${MAX_INPUT_VALUE_LENGTH} characters`;
    case "TOO_MANY_KEYS":
      return `At most ${MAX_CUSTOM_INPUT_KEYS} inputs are allowed (got ${err.count})`;
    case "TOO_LARGE":
      return `Inputs exceed ${MAX_INPUTS_TOTAL_BYTES} bytes in total`;
    case "NOT_AN_OBJECT":
      return "Inputs must be an object of string values";
  }
}
