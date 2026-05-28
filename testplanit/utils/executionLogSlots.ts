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
 */
export function mergeResultsIntoSlots(
  expectedSlots: ExpectedSlot[],
  stepResults: StepResultRow[],
  testRunResultId: number
): ExecutionLogStepRow[] {
  const resultBySlotKey = new Map<string, StepResultRow>();
  for (const sr of stepResults) {
    resultBySlotKey.set(`${sr.stepId}:${sr.sharedStepItemId ?? 0}`, sr);
  }
  return expectedSlots.map((slot) => {
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
}
