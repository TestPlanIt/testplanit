/**
 * Normalization for the Steps value an LLM returns for a generated test case.
 *
 * The prompt asks for an array of `{ step, expectedResult }` objects, but a
 * model is free to answer with a single object, a bare string holding a
 * numbered list, an array of plain strings, or objects keyed `action` /
 * `expected`. The wizard preview, the edit form, and the import all read the
 * same value, so they normalize through here and agree on the step count.
 */

export interface NormalizedGeneratedStep {
  step: any;
  expectedResult: any;
  [key: string]: any;
}

/** Key spellings a model uses for the action, in priority order. */
const STEP_KEYS = ["step", "action", "instruction", "teststep", "description"];

/** Key spellings a model uses for the expected result, in priority order. */
const RESULT_KEYS = [
  "expectedresult",
  "expectedoutcome",
  "expected",
  "outcome",
  "result",
];

/** `Expected_Result` / `expected result` / `ExpectedResult` all compare equal. */
function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickByKeys(entry: Record<string, any>, keys: string[]): any {
  const byCanonical = new Map<string, any>();
  for (const [key, value] of Object.entries(entry)) {
    const canonical = canonicalKey(key);
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, value);
  }
  for (const key of keys) {
    const value = byCanonical.get(key);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** A TipTap document is a step body, not a container of steps. */
function isTipTapDoc(value: any): boolean {
  return Boolean(
    value && typeof value === "object" && (value as any).type === "doc"
  );
}

const LIST_MARKER = /^(?:\d+[.)]|[-*•])\s+/;

/**
 * Split a text blob into one step per line, but only when every line carries a
 * list marker — otherwise a multi-line single step would be torn apart.
 * Returns null when the text is one step.
 */
function splitListText(text: string): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return null;
  if (!lines.every((line) => LIST_MARKER.test(line))) return null;

  return lines.map((line) => line.replace(LIST_MARKER, "").trim());
}

function fromText(text: string): NormalizedGeneratedStep[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = splitListText(trimmed);
  if (parts) {
    return parts.map((part) => ({ step: part, expectedResult: "" }));
  }

  return [{ step: trimmed, expectedResult: "" }];
}

function fromEntry(entry: any): NormalizedGeneratedStep[] {
  if (entry === null || entry === undefined) return [];
  if (typeof entry === "string") return fromText(entry);
  if (typeof entry !== "object") return fromText(String(entry));

  if (isTipTapDoc(entry)) {
    return [{ step: entry, expectedResult: "" }];
  }

  const step = pickByKeys(entry, STEP_KEYS);
  const expectedResult = pickByKeys(entry, RESULT_KEYS);
  if (step === undefined && expectedResult === undefined) return [];

  // Spread first so shared-step metadata (sharedStepGroupId, order, id)
  // survives; the normalized pair wins.
  return [{ ...entry, step: step ?? "", expectedResult: expectedResult ?? "" }];
}

/**
 * A lone step whose text is a marker list is a whole test case packed into one
 * object — the shape the preview showed as a single step. Split it, leaving the
 * expected result on the last step. Only applied to a one-step value: a model
 * that already broke the case into steps is never restructured.
 */
function unpackSingleListStep(
  steps: NormalizedGeneratedStep[]
): NormalizedGeneratedStep[] {
  if (steps.length !== 1) return steps;

  const [only] = steps;
  if (typeof only.step !== "string" || only.sharedStepGroupId) return steps;

  const parts = splitListText(only.step);
  if (!parts) return steps;

  return parts.map((part, index) => ({
    ...only,
    step: part,
    expectedResult: index === parts.length - 1 ? only.expectedResult : "",
  }));
}

/** Every step the value carries, in order. Empty when it carries none. */
export function normalizeGeneratedSteps(value: any): NormalizedGeneratedStep[] {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return unpackSingleListStep(value.flatMap((entry) => fromEntry(entry)));
  }

  if (typeof value === "string") return fromText(value);

  return unpackSingleListStep(fromEntry(value));
}

/**
 * The fieldValues entry holding the steps, for callers without the template to
 * name it (the streaming preview). Prefers a Steps-named key, then any value
 * shaped like a step list.
 */
export function findGeneratedStepsEntry(
  fieldValues: Record<string, any> | undefined
): { key: string; steps: NormalizedGeneratedStep[] } | null {
  if (!fieldValues) return null;

  const entries = Object.entries(fieldValues);
  const named = entries.filter(([key]) => canonicalKey(key).includes("step"));
  // Without the template, only a step-shaped value identifies itself — a
  // Multi-Select array or a text field must not be mistaken for steps.
  const shaped = entries.filter(([, value]) => looksLikeStepList(value));

  for (const [key, value] of [...named, ...shaped]) {
    if (typeof value === "string" && !canonicalKey(key).includes("step")) {
      continue;
    }
    const steps = normalizeGeneratedSteps(value);
    if (steps.length > 0) return { key, steps };
  }

  return null;
}

function looksLikeStepList(value: any): boolean {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.some(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !isTipTapDoc(entry) &&
      (pickByKeys(entry, STEP_KEYS) !== undefined ||
        pickByKeys(entry, RESULT_KEYS) !== undefined)
  );
}
