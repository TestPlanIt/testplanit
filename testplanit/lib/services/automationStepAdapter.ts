/**
 * Automation step adapter for test-results import.
 *
 * Converts the parsed `ITestStep[]` of a single test case (from
 * `test-results-parser`) into the normalized `AutomationStep[]` shape consumed
 * by the shared `@testplanit/api` mapper. Pure, DB-free, synchronous — the
 * importer owns the DB write and the never-overwrite guard; this adapter only
 * normalizes step structure.
 *
 * Coverage by format:
 *   - Cucumber: each `step.name` carries the Gherkin keyword as a prefix
 *     (`"Given I am on the login page"`); there is no separate keyword field.
 *     The adapter parses the leading `Given/When/Then/And/But`, strips it from
 *     the title, and maps it to a `kind` (Given→precondition, When→action,
 *     Then→assertion). `And`/`But` inherit the nearest prior primary keyword.
 *   - Playwright-JUnit / Mocha / plain JUnit: `ITestCase.steps` is empty, so
 *     the adapter returns `[]` (graceful-skip — the mapper then writes nothing,
 *     and those formats are left to the Playwright reporter or the LLM path).
 *   - A step whose name carries no recognized Gherkin keyword falls through to
 *     a plain `action` step with the full name as the title.
 */
import type { ITestStep } from "test-results-parser";
import type { AutomationStep } from "@testplanit/api";
import type { TestResultFormat } from "./testResultsParser";

/** Gherkin keywords scanned in order; the first matching prefix wins. */
const GHERKIN_KEYWORDS = ["Given", "When", "Then", "And", "But"] as const;

/** Keywords that set the current step role; `And`/`But` inherit instead. */
const PRIMARY_KEYWORDS = new Set<string>(["Given", "When", "Then"]);

/** Primary Gherkin keyword → normalized step kind. */
const KIND_MAP: Record<string, AutomationStep["kind"]> = {
  Given: "precondition",
  When: "action",
  Then: "assertion",
};

/**
 * Normalize a parsed test case's steps into `AutomationStep[]`.
 *
 * Returns `[]` for empty input (stepless formats — graceful-skip). The
 * `format` param is accepted for signature stability / future per-format
 * branching but is not consumed by the current Cucumber path.
 */
export function adaptTestSteps(
  steps: ITestStep[],
  _format: TestResultFormat,
): AutomationStep[] {
  if (steps.length === 0) return [];

  const result: AutomationStep[] = [];
  // `And`/`But` inherit the kind of the nearest prior primary keyword.
  let lastPrimaryKind: AutomationStep["kind"] = "action";

  for (const step of steps) {
    let title = step.name;
    let kind: AutomationStep["kind"] = "action";

    for (const kw of GHERKIN_KEYWORDS) {
      if (step.name.startsWith(kw + " ")) {
        // Strip "Keyword " — the parser inserts exactly one trailing space.
        title = step.name.slice(kw.length + 1);
        if (PRIMARY_KEYWORDS.has(kw)) {
          kind = KIND_MAP[kw];
          lastPrimaryKind = kind;
        } else {
          kind = lastPrimaryKind;
        }
        break;
      }
    }

    result.push({ title, kind });
  }

  return result;
}
