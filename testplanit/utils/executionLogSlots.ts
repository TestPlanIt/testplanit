// Pure helpers for the execution-log report. Kept free of server-only imports
// so they can be unit-tested without pulling in Prisma/auth.

export interface ExecutionLogStepRow {
  isStep: true;
  id: string;
  stepNumber: string;
  stepText: string;
  expectedResult: string;
  sharedGroupName: string | null;
  status: { name: string; color: string };
  elapsed: number | null;
  executedAt: string | null;
  /**
   * True when this row is a recorded result whose step has since been removed
   * from the test case. The result stays in the report — it is what was
   * actually executed — but the reader needs to know it no longer maps to a
   * live step.
   */
  isRemovedStep?: boolean;
}

// Sentinel used for slots in the case definition that have no
// TestRunStepResult row recorded yet. The client renders this with the same
// Untested colour the system uses elsewhere.
export const UNTESTED_STATUS = { name: "Untested", color: "#B1B2B3" };

export function tiptapToPlainText(doc: unknown): string {
  if (!doc) return "";
  if (typeof doc === "string") {
    try {
      return tiptapToPlainText(JSON.parse(doc));
    } catch {
      return doc;
    }
  }
  if (typeof doc !== "object") return "";
  const node = doc as { text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content
      .map((child) => tiptapToPlainText(child))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

export interface StepRow {
  id: number;
  order: number;
  testCaseId: number;
  sharedStepGroupId: number | null;
  step: unknown;
  expectedResult: unknown;
}

export interface SharedItemRow {
  id: number;
  order: number;
  sharedStepGroupId: number;
  step: unknown;
  expectedResult: unknown;
}

export interface SharedGroupRow {
  id: number;
  name: string | null;
}

export interface ExpectedSlot {
  key: string; // `${stepId}:${sharedItemId | 0}`
  stepNumber: string;
  stepText: string;
  expectedResult: string;
  sharedGroupName: string | null;
}

export interface StepResultRow {
  id: number;
  stepId: number;
  sharedStepItemId: number | null;
  elapsed: number | null;
  executedAt: Date | string | null;
  stepStatus: { name: string; color: { value: string } | null } | null;
  /**
   * The step this result was recorded against, read through the result's own
   * to-one relation so it resolves even after the step is soft-deleted. Used
   * to render results whose step is no longer on the case.
   */
  step?: {
    step: unknown;
    expectedResult: unknown;
    order: number;
    testCaseId: number;
  } | null;
  sharedStepItem?: { step: unknown; expectedResult: unknown } | null;
}

/**
 * Builds the canonical step list for each test case, expanding shared step
 * group placeholders into one row per shared item. Step numbering matches the
 * case detail page: 1-based sequential rank within the case (caller is
 * expected to pass steps already ordered by `order` ASC, then `id` ASC), with
 * dotted `placeholderRank.itemRank` for shared sub-items.
 */
export function buildExpectedSlotsByCaseId(
  caseSteps: StepRow[],
  sharedItems: SharedItemRow[],
  sharedGroups: SharedGroupRow[]
): Map<number, ExpectedSlot[]> {
  const groupNameById = new Map<number, string>();
  for (const g of sharedGroups) groupNameById.set(g.id, g.name ?? "");

  const itemsByGroupId = new Map<number, SharedItemRow[]>();
  for (const item of sharedItems) {
    if (!itemsByGroupId.has(item.sharedStepGroupId)) {
      itemsByGroupId.set(item.sharedStepGroupId, []);
    }
    itemsByGroupId.get(item.sharedStepGroupId)!.push(item);
  }

  const stepsByCaseId = new Map<number, StepRow[]>();
  for (const s of caseSteps) {
    if (!stepsByCaseId.has(s.testCaseId)) stepsByCaseId.set(s.testCaseId, []);
    stepsByCaseId.get(s.testCaseId)!.push(s);
  }

  const slotsByCaseId = new Map<number, ExpectedSlot[]>();
  for (const [caseId, steps] of stepsByCaseId.entries()) {
    const slots: ExpectedSlot[] = [];
    steps.forEach((step, stepIdx) => {
      const placeholderRank = stepIdx + 1;
      if (step.sharedStepGroupId != null) {
        const items = itemsByGroupId.get(step.sharedStepGroupId) ?? [];
        const groupName = groupNameById.get(step.sharedStepGroupId) ?? null;
        items.forEach((item, itemIdx) => {
          const itemRank = itemIdx + 1;
          slots.push({
            key: `${step.id}:${item.id}`,
            stepNumber: `${placeholderRank}.${itemRank}`,
            stepText: tiptapToPlainText(item.step).trim(),
            expectedResult: tiptapToPlainText(item.expectedResult).trim(),
            sharedGroupName: groupName,
          });
        });
      } else {
        slots.push({
          key: `${step.id}:0`,
          stepNumber: `${placeholderRank}`,
          stepText: tiptapToPlainText(step.step).trim(),
          expectedResult: tiptapToPlainText(step.expectedResult).trim(),
          sharedGroupName: null,
        });
      }
    });
    slotsByCaseId.set(caseId, slots);
  }
  return slotsByCaseId;
}

/**
 * Merges a test-run's actual step results into the case's expected slot list.
 * Slots without a matching result render with the Untested sentinel status.
 *
 * Results with no matching slot are appended rather than dropped: their step
 * was soft-deleted from the case after the run was executed, but the result is
 * still a real record of what was run. They are flagged `isRemovedStep` and
 * numbered after the live slots.
 *
 * An unmatched result is only treated as a removed step when its step is known
 * to belong to `testCaseId`. Without that proof a stray result is dropped as
 * before, so a result belonging to another case can never leak into this one.
 */
export function mergeResultsIntoSlots(
  expectedSlots: ExpectedSlot[],
  stepResults: StepResultRow[],
  testRunResultId: number,
  testCaseId?: number
): ExecutionLogStepRow[] {
  const resultBySlotKey = new Map<string, StepResultRow>();
  for (const sr of stepResults) {
    resultBySlotKey.set(`${sr.stepId}:${sr.sharedStepItemId ?? 0}`, sr);
  }
  const slotKeys = new Set(expectedSlots.map((slot) => slot.key));
  const rows: ExecutionLogStepRow[] = expectedSlots.map((slot) => {
    const sr = resultBySlotKey.get(slot.key);
    if (sr) {
      return {
        isStep: true,
        id: `step-${sr.id}`,
        stepNumber: slot.stepNumber,
        stepText: slot.stepText,
        expectedResult: slot.expectedResult,
        sharedGroupName: slot.sharedGroupName,
        status: {
          name: sr.stepStatus?.name ?? UNTESTED_STATUS.name,
          color: sr.stepStatus?.color?.value ?? UNTESTED_STATUS.color,
        },
        elapsed: sr.elapsed ?? null,
        executedAt: sr.executedAt
          ? sr.executedAt instanceof Date
            ? sr.executedAt.toISOString()
            : sr.executedAt
          : null,
      };
    }
    return {
      isStep: true,
      id: `slot-${testRunResultId}-${slot.key}`,
      stepNumber: slot.stepNumber,
      stepText: slot.stepText,
      expectedResult: slot.expectedResult,
      sharedGroupName: slot.sharedGroupName,
      status: UNTESTED_STATUS,
      elapsed: null,
      executedAt: null,
    };
  });

  const orphans = stepResults
    .filter(
      (sr) =>
        !slotKeys.has(`${sr.stepId}:${sr.sharedStepItemId ?? 0}`) &&
        testCaseId !== undefined &&
        sr.step?.testCaseId === testCaseId
    )
    .sort((a, b) => (a.step?.order ?? 0) - (b.step?.order ?? 0) || a.id - b.id);

  // Continue numbering from the highest live placeholder rank. Shared-step
  // slots carry dotted `rank.item` numbers, so the row count is not the rank.
  const maxRank = expectedSlots.reduce(
    (max, slot) => Math.max(max, parseInt(slot.stepNumber, 10) || 0),
    0
  );

  orphans.forEach((sr, index) => {
    const content = sr.sharedStepItem ?? sr.step;
    rows.push({
      isStep: true,
      id: `step-${sr.id}`,
      stepNumber: `${maxRank + index + 1}`,
      stepText: tiptapToPlainText(content?.step).trim(),
      expectedResult: tiptapToPlainText(content?.expectedResult).trim(),
      sharedGroupName: null,
      status: {
        name: sr.stepStatus?.name ?? UNTESTED_STATUS.name,
        color: sr.stepStatus?.color?.value ?? UNTESTED_STATUS.color,
      },
      elapsed: sr.elapsed ?? null,
      executedAt: sr.executedAt
        ? sr.executedAt instanceof Date
          ? sr.executedAt.toISOString()
          : sr.executedAt
        : null,
      isRemovedStep: true,
    });
  });

  return rows;
}
