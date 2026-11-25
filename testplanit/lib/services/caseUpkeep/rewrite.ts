import { coerceCaseFieldValue } from "~/lib/services/caseFieldValueCoercion";
import type { FieldMapping } from "~/lib/services/jira-panel-generation";
import { convertStepToTipTap } from "~/lib/services/testCaseImport";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import {
  readableFieldValue,
  toUpkeepCase,
  type UpkeepCaseText,
} from "./caseText";

export type RewriteResult =
  | { ok: true; version: number; skippedFields: string[] }
  | { ok: false; reason: "gone" | "changed" };

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Save a proposed test case over the existing one as a new version, inside
 * the caller's transaction. Only what differs from the case as it reads now
 * is written, so the formatting of untouched rich text and steps survives.
 * Steps keep their rows in order (step results point at them): changed steps
 * are rewritten, extra ones added and surplus ones deleted. A case that
 * shares steps with others keeps its steps as they are.
 *
 * Refuses when the case is gone, or is no longer at `expectedVersion`: the
 * proposal was made against a case that has since changed.
 */
export async function rewriteCase(
  tx: any,
  params: {
    caseId: number;
    expectedVersion: number;
    proposed: UpkeepCaseText;
    fieldMappings: FieldMapping[];
  }
): Promise<RewriteResult> {
  const { caseId, expectedVersion, proposed, fieldMappings } = params;
  const row = await tx.repositoryCases.findFirst({
    where: { id: caseId, isDeleted: false },
    select: {
      id: true,
      name: true,
      currentVersion: true,
      caseFieldValues: { select: { id: true, fieldId: true, value: true } },
      steps: {
        where: { isDeleted: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          step: true,
          expectedResult: true,
          order: true,
          sharedStepGroupId: true,
        },
      },
    },
  });
  if (!row) return { ok: false, reason: "gone" };
  if (row.currentVersion !== expectedVersion) {
    return { ok: false, reason: "changed" };
  }

  const version = expectedVersion + 1;
  const claimed = await tx.repositoryCases.updateMany({
    where: { id: caseId, currentVersion: expectedVersion, isDeleted: false },
    data: {
      name: (proposed.name.trim() || row.name).slice(0, 255),
      currentVersion: version,
    },
  });
  if (claimed.count === 0) return { ok: false, reason: "changed" };

  const current = toUpkeepCase(row, fieldMappings);
  const skippedFields: string[] = [];
  for (const mapping of fieldMappings) {
    if (!(mapping.fieldName in proposed.fieldValues)) continue;
    const wanted = proposed.fieldValues[mapping.fieldName];
    if (wanted == null) continue;
    const stored = row.caseFieldValues.find(
      (value: { fieldId: number }) => value.fieldId === mapping.caseFieldId
    );
    if (same(readableFieldValue(mapping, stored?.value), wanted)) continue;
    const coerced = coerceCaseFieldValue(mapping, wanted);
    if (!coerced.ok) {
      skippedFields.push(mapping.fieldName);
      continue;
    }
    if (stored) {
      await tx.caseFieldValues.update({
        where: { id: stored.id },
        data: { value: coerced.value },
      });
    } else {
      await tx.caseFieldValues.create({
        data: {
          testCaseId: caseId,
          fieldId: mapping.caseFieldId,
          value: coerced.value,
        },
      });
    }
  }

  if (!current.stepsFixed) {
    const lastOrder = row.steps.reduce(
      (max: number, step: { order: number }) => Math.max(max, step.order),
      -1
    );
    for (const [index, wanted] of proposed.steps.entries()) {
      const existing = row.steps[index];
      if (!existing) {
        await tx.steps.create({
          data: {
            testCaseId: caseId,
            step: convertStepToTipTap(wanted.step),
            expectedResult: convertStepToTipTap(wanted.expectedResult),
            order: lastOrder + 1 + index - row.steps.length,
          },
        });
        continue;
      }
      if (same(current.steps[index], wanted)) continue;
      await tx.steps.update({
        where: { id: existing.id },
        data: {
          step: convertStepToTipTap(wanted.step),
          expectedResult: convertStepToTipTap(wanted.expectedResult),
        },
      });
    }
    const surplus = row.steps
      .slice(proposed.steps.length)
      .map((step: { id: number }) => step.id);
    if (surplus.length > 0) {
      await tx.steps.updateMany({
        where: { id: { in: surplus } },
        data: { isDeleted: true },
      });
    }
  }

  await createTestCaseVersionInTransaction(tx, caseId, {
    copyFieldValues: true,
  });
  return { ok: true, version, skippedFields };
}
