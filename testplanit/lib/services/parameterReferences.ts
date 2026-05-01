/**
 * Server-side helpers that scan and rewrite `parameterMention` references
 * across a test case's Tiptap step content and its attached DataSet rows.
 *
 * Used by the parameter mutation server endpoints (Phase 2 Plan 02-02):
 *   - GET  scan-references endpoint surfaces counts before destructive
 *     actions (rename, delete) so the user can see usage before confirming.
 *   - PATCH parameter rename invokes rewrite to atomically rewrite every
 *     reference in the same `$transaction` as the rename.
 *
 * Implementation notes:
 *   - `step.step` and `step.expectedResult` may be Json (object) OR a
 *     stringified JSON blob. We mirror the defensive parsing pattern from
 *     StepsForm.tsx:561 (mapPrismaJsonToTipTapContent).
 *   - DataSet rows store values keyed by parameter name. A "reference" is
 *     a key whose name matches the parameter being scanned/renamed.
 *   - Both helpers accept a transaction client (`tx`) so callers can scope
 *     them inside an outer `db.$transaction(...)`. Atomicity is the
 *     caller's responsibility.
 */

export interface ParameterReferences {
  stepCount: number;
  expectedCount: number;
  rowCount: number;
  steps: Array<{
    stepId: number;
    field: "step" | "expectedResult";
    nodeIndex: number;
  }>;
  rows: Array<{ rowId: number; key: string }>;
}

type TipTapNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
};

function parseTipTapJson(raw: unknown): TipTapNode | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as TipTapNode;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as TipTapNode;
  return null;
}

/**
 * Recursively walks a Tiptap document tree, invoking `visit` for each node
 * with its zero-based index among its parent's children. The root node has
 * index 0.
 */
function walkNodes(
  node: TipTapNode | null,
  visit: (n: TipTapNode, index: number) => void,
  index = 0,
): void {
  if (!node) return;
  visit(node, index);
  const children = Array.isArray(node.content) ? node.content : [];
  for (let i = 0; i < children.length; i++) {
    walkNodes(children[i], visit, i);
  }
}

function isMatchingMention(
  node: TipTapNode,
  paramName: string,
): boolean {
  if (node.type !== "parameterMention") return false;
  const label = node.attrs?.label;
  return typeof label === "string" && label === paramName;
}

/**
 * Recursively rebuilds a Tiptap document, renaming every `parameterMention`
 * whose `attrs.label === oldName` to use `newName`. Returns a NEW object
 * graph; the input is not mutated. Returns `{ doc, changed }` where
 * `changed === true` iff at least one mention was rewritten.
 */
function renameInDoc(
  node: TipTapNode | null,
  oldName: string,
  newName: string,
): { doc: TipTapNode | null; changed: boolean } {
  if (!node) return { doc: null, changed: false };
  let changed = false;
  let nextAttrs = node.attrs;
  if (
    node.type === "parameterMention" &&
    typeof node.attrs?.label === "string" &&
    node.attrs.label === oldName
  ) {
    nextAttrs = { ...node.attrs, id: newName, label: newName };
    changed = true;
  }
  let nextContent = node.content;
  if (Array.isArray(node.content)) {
    const rebuilt: TipTapNode[] = [];
    let childChanged = false;
    for (const child of node.content) {
      const result = renameInDoc(child, oldName, newName);
      childChanged = childChanged || result.changed;
      rebuilt.push(result.doc as TipTapNode);
    }
    if (childChanged) {
      nextContent = rebuilt;
      changed = true;
    }
  }
  if (!changed) return { doc: node, changed: false };
  return { doc: { ...node, attrs: nextAttrs, content: nextContent }, changed: true };
}

export async function scanParameterReferences(
  tx: any,
  caseId: number,
  paramName: string,
): Promise<ParameterReferences> {
  const steps = (await tx.steps.findMany({
    where: { testCaseId: caseId, isDeleted: false },
    select: { id: true, step: true, expectedResult: true },
  })) as Array<{ id: number; step: unknown; expectedResult: unknown }>;

  const stepHits: ParameterReferences["steps"] = [];
  let stepCount = 0;
  let expectedCount = 0;

  for (const s of steps) {
    const stepDoc = parseTipTapJson(s.step);
    walkNodes(stepDoc, (n, idx) => {
      if (isMatchingMention(n, paramName)) {
        stepCount += 1;
        stepHits.push({ stepId: s.id, field: "step", nodeIndex: idx });
      }
    });
    const expectedDoc = parseTipTapJson(s.expectedResult);
    walkNodes(expectedDoc, (n, idx) => {
      if (isMatchingMention(n, paramName)) {
        expectedCount += 1;
        stepHits.push({
          stepId: s.id,
          field: "expectedResult",
          nodeIndex: idx,
        });
      }
    });
  }

  const dataset = await tx.dataSet.findFirst({
    where: { ownerCaseId: caseId, isDeleted: false },
    include: {
      rows: { where: { isDeleted: false }, select: { id: true, valuesJson: true } },
    },
  });

  const rowHits: ParameterReferences["rows"] = [];
  let rowCount = 0;
  if (dataset && Array.isArray(dataset.rows)) {
    for (const row of dataset.rows as Array<{ id: number; valuesJson: unknown }>) {
      const values = (row.valuesJson ?? {}) as Record<string, unknown>;
      if (
        values &&
        typeof values === "object" &&
        Object.prototype.hasOwnProperty.call(values, paramName)
      ) {
        rowCount += 1;
        rowHits.push({ rowId: row.id, key: paramName });
      }
    }
  }

  return {
    stepCount,
    expectedCount,
    rowCount,
    steps: stepHits,
    rows: rowHits,
  };
}

export async function rewriteParameterReferences(
  tx: any,
  caseId: number,
  oldName: string,
  newName: string,
): Promise<void> {
  if (oldName === newName) return;

  const steps = (await tx.steps.findMany({
    where: { testCaseId: caseId, isDeleted: false },
    select: { id: true, step: true, expectedResult: true },
  })) as Array<{ id: number; step: unknown; expectedResult: unknown }>;

  for (const s of steps) {
    const originalStepWasString = typeof s.step === "string";
    const originalExpectedWasString = typeof s.expectedResult === "string";
    const stepDoc = parseTipTapJson(s.step);
    const expectedDoc = parseTipTapJson(s.expectedResult);
    const stepRename = renameInDoc(stepDoc, oldName, newName);
    const expectedRename = renameInDoc(expectedDoc, oldName, newName);
    if (!stepRename.changed && !expectedRename.changed) continue;

    const data: Record<string, unknown> = {};
    if (stepRename.changed) {
      data.step = originalStepWasString
        ? JSON.stringify(stepRename.doc)
        : stepRename.doc;
    }
    if (expectedRename.changed) {
      data.expectedResult = originalExpectedWasString
        ? JSON.stringify(expectedRename.doc)
        : expectedRename.doc;
    }
    await tx.steps.update({ where: { id: s.id }, data });
  }

  const dataset = await tx.dataSet.findFirst({
    where: { ownerCaseId: caseId, isDeleted: false },
    include: {
      rows: { where: { isDeleted: false }, select: { id: true, valuesJson: true } },
    },
  });
  if (!dataset || !Array.isArray(dataset.rows)) return;

  for (const row of dataset.rows as Array<{ id: number; valuesJson: unknown }>) {
    const values = (row.valuesJson ?? {}) as Record<string, unknown>;
    if (
      !values ||
      typeof values !== "object" ||
      !Object.prototype.hasOwnProperty.call(values, oldName)
    ) {
      continue;
    }
    const next: Record<string, unknown> = { ...values };
    next[newName] = next[oldName];
    delete next[oldName];
    await tx.dataSetRow.update({
      where: { id: row.id },
      data: { valuesJson: next },
    });
  }
}
