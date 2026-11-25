import { extractJsonObject } from "~/lib/llm/services/json-extract";
import type { UpkeepCase, UpkeepCaseText } from "./caseText";

/** What the model decided for one linked test case. */
export type UpkeepDecision =
  | { caseId: number; action: "unchanged" }
  | {
      caseId: number;
      action: "update";
      reason: string;
      /** The whole case after the change. */
      proposed: UpkeepCaseText;
    }
  | { caseId: number; action: "retire"; reason: string };

export type UpkeepParseResult =
  | {
      ok: true;
      decisions: UpkeepDecision[];
      newCases: UpkeepCaseText[];
      /** Parts of the answer that were ignored, for the action log. */
      problems: string[];
    }
  | { ok: false; error: string };

/** The most new cases one answer may add. */
export const MAX_NEW_CASES = 20;
const MAX_REASON_LENGTH = 500;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

function readSteps(value: unknown): UpkeepCaseText["steps"] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((entry) => ({
      step: text((entry as { step?: unknown } | null)?.step),
      expectedResult: text(
        (entry as { expectedResult?: unknown } | null)?.expectedResult
      ),
    }))
    .filter((step) => step.step !== "");
}

function readFieldValues(
  value: unknown,
  fieldNames: ReadonlySet<string>
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [name, fieldValue] of Object.entries(value)) {
    if (fieldNames.has(name) && fieldValue != null) out[name] = fieldValue;
  }
  return out;
}

const sameText = (a: UpkeepCaseText, b: UpkeepCaseText): boolean =>
  JSON.stringify([a.name, a.steps, sortedEntries(a.fieldValues)]) ===
  JSON.stringify([b.name, b.steps, sortedEntries(b.fieldValues)]);

const sortedEntries = (values: Record<string, unknown>) =>
  Object.entries(values).sort(([a], [b]) => a.localeCompare(b));

/**
 * Read the model's answer against the cases it was given. Every given case
 * gets a decision: one the answer leaves out, names twice, or gives an
 * unknown action stays unchanged. An update keeps whatever it does not
 * mention, never touches fixed steps, and counts as unchanged when it changes
 * nothing.
 */
export function parseUpkeepResponse(
  content: string,
  cases: UpkeepCase[],
  fieldNames: string[]
): UpkeepParseResult {
  const json = extractJsonObject(content);
  let parsed: { cases?: unknown; newCases?: unknown };
  try {
    parsed = JSON.parse(json ?? "");
  } catch {
    return { ok: false, error: "The model's answer was not valid JSON" };
  }

  const known = new Set(fieldNames);
  const problems: string[] = [];
  const entries = new Map<number, Record<string, unknown>>();
  for (const entry of Array.isArray(parsed.cases) ? parsed.cases : []) {
    const id = Number((entry as { id?: unknown } | null)?.id);
    if (!cases.some((testCase) => testCase.id === id)) {
      problems.push(`ignored an answer for unknown case ${String(id)}`);
      continue;
    }
    if (entries.has(id)) {
      problems.push(`ignored a second answer for case ${id}`);
      continue;
    }
    entries.set(id, entry as Record<string, unknown>);
  }

  const decisions: UpkeepDecision[] = cases.map((current) => {
    const entry = entries.get(current.id);
    if (!entry) {
      problems.push(`no answer for case ${current.id}`);
      return { caseId: current.id, action: "unchanged" };
    }
    const reason = text(entry.reason).slice(0, MAX_REASON_LENGTH);
    switch (entry.action) {
      case "unchanged":
        return { caseId: current.id, action: "unchanged" };
      case "retire":
        return { caseId: current.id, action: "retire", reason };
      case "update": {
        const steps = current.stepsFixed ? null : readSteps(entry.steps);
        const proposed: UpkeepCaseText = {
          name: text(entry.name) || current.name,
          fieldValues: {
            ...current.fieldValues,
            ...readFieldValues(entry.fieldValues, known),
          },
          steps: steps ?? current.steps,
        };
        if (sameText(proposed, current)) {
          return { caseId: current.id, action: "unchanged" };
        }
        return { caseId: current.id, action: "update", reason, proposed };
      }
      default:
        problems.push(
          `unknown action for case ${current.id}: ${String(entry.action)}`
        );
        return { caseId: current.id, action: "unchanged" };
    }
  });

  const newCases: UpkeepCaseText[] = [];
  for (const entry of Array.isArray(parsed.newCases) ? parsed.newCases : []) {
    const name = text((entry as { name?: unknown } | null)?.name);
    if (!name) {
      problems.push("ignored a new case without a name");
      continue;
    }
    if (newCases.length >= MAX_NEW_CASES) {
      problems.push(`ignored new cases beyond ${MAX_NEW_CASES}`);
      break;
    }
    newCases.push({
      name,
      fieldValues: readFieldValues(
        (entry as { fieldValues?: unknown }).fieldValues,
        known
      ),
      steps: readSteps((entry as { steps?: unknown }).steps) ?? [],
    });
  }

  return { ok: true, decisions, newCases, problems };
}
