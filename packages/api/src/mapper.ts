import type { AutomationStep, CaseStepRow } from './types.js';

/**
 * Convert a normalized `AutomationStep[]` into ordered, plain-text case
 * `Steps` rows. Pure, DB-free, format-agnostic, synchronous: the per-surface
 * adapter (the result importer or the Playwright / WDIO reporters) produces
 * the normalized input and decides what counts as a mappable step — this
 * mapper does NO trace-filtering and trusts its input (D-02, D-15). The caller
 * wraps each row's `step`/`expectedResult` into TipTap-JSON on write; this
 * function itself never touches the DB or an LLM.
 *
 * Deterministic split rules:
 *  - precondition (Gherkin `Given`) → a leading "Step 0" row, no expectedResult (D-08)
 *  - action (Gherkin `When`)        → a step row (D-07)
 *  - assertion (Gherkin `Then`)     → does NOT create a row; its title becomes the
 *      expectedResult of the LAST step of the immediately preceding When-group.
 *      A contiguous group of assertions CONCATENATES (joined with "\n") into that
 *      single expectedResult — never new rows (D-07). With no preceding When it
 *      attaches to the last emitted row, e.g. the last Given/Step-0 (D-08).
 *  - Playwright nesting (D-09): an action whose immediate `children` include
 *      assertion(s) takes their joined titles as its expectedResult.
 *
 * Steps that are not the last in a When-group keep an empty (omitted)
 * expectedResult — one is never invented (D-07, D-10); an empty expectedResult
 * is valid output. Returns `[]` for empty/low-structure input (D-14).
 *
 * Single non-recursive O(n) pass over the top-level array; `children` are
 * inspected only one level deep, bounding stack depth and time (DoS, T-01-01).
 */
export function automationStepsToCaseSteps(steps: AutomationStep[]): CaseStepRow[] {
  const rows: CaseStepRow[] = [];
  let order = 0;
  // Index of the row that a pending assertion attaches to: the last step of the
  // current When-group, or the last emitted row when no When preceded it (D-08).
  let attachIndex = -1;

  const appendExpected = (index: number, title: string): void => {
    if (index < 0) return; // nothing emitted yet — nowhere to attach
    const row = rows[index];
    row.expectedResult =
      row.expectedResult === undefined || row.expectedResult === ''
        ? title
        : `${row.expectedResult}\n${title}`;
  };

  for (const step of steps) {
    if (step.kind === 'assertion') {
      // Gherkin `Then` (or a stray top-level assertion): fold onto the attach
      // target. Contiguous assertions accumulate into the SAME expectedResult.
      appendExpected(attachIndex, step.title);
      continue;
    }

    // precondition (Given) or action (When): emit a step row.
    const row: CaseStepRow = { step: step.title, order: order++ };

    // Playwright (D-09): an immediately-nested assertion child (the `expect`
    // step) becomes this row's expectedResult. One level deep only (T-01-01).
    if (step.children && step.children.length > 0) {
      const nested = step.children
        .filter((child) => child.kind === 'assertion')
        .map((child) => child.title);
      if (nested.length > 0) row.expectedResult = nested.join('\n');
    }

    rows.push(row);
    attachIndex = rows.length - 1;
  }

  return rows;
}

/**
 * Never-overwrite guard wrapper (CORE-01). Encodes the decision "only derive
 * steps for a case that has none" given a caller-supplied signal — it does NOT
 * query the database itself. The live "does this case already have steps?"
 * fetch is the per-surface call site's job, deferred to later phases (Phase 2
 * importer: `prisma.steps.findFirst({ where: { testCaseId, isDeleted: false } })`;
 * Phase 3 reporter: its existing client) (D-11, D-12).
 *
 * When `existingStepCount >= 1` (the case already has at least one non-deleted
 * step), returns `[]` with no side effects — derivation never clobbers
 * existing, possibly human-edited steps. When `existingStepCount === 0`,
 * returns the full mapped rows.
 *
 * This wrapper does NOT remove or bypass the reporters' explicit, opt-in
 * `overwriteSteps` escape hatch — that destructive opt-in stays a documented
 * caller concern (D-13).
 */
export function deriveCaseStepsIfFresh(
  steps: AutomationStep[],
  existingStepCount: number,
): CaseStepRow[] {
  if (existingStepCount >= 1) return [];
  return automationStepsToCaseSteps(steps);
}
