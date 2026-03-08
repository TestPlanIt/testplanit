import { prisma } from "~/lib/prisma";

/**
 * Minimal shape required for a step to be resolved.
 * Matches the fields returned by both exportSelectClause and quickScriptActions queries.
 */
export interface StepWithSharedRef {
  id: number;
  step: any;
  expectedResult: any;
  order: number;
  isDeleted?: boolean;
  sharedStepGroupId: number | null;
  [key: string]: any;
}

/**
 * Resolves shared step references in-place for an array of cases.
 *
 * When a step has `sharedStepGroupId` set, it's a placeholder whose actual content
 * lives in `SharedStepItem` records. This function replaces those placeholders with
 * the real step items from the shared step group, maintaining insertion order.
 *
 * Uses a single batch query for all shared step groups across all cases.
 */
export async function resolveSharedSteps<
  T extends { steps?: StepWithSharedRef[] },
>(cases: T[]): Promise<T[]> {
  // Collect all unique sharedStepGroupIds across all cases
  const sharedGroupIds = new Set<number>();
  for (const c of cases) {
    for (const step of c.steps ?? []) {
      if (step.sharedStepGroupId != null) {
        sharedGroupIds.add(step.sharedStepGroupId);
      }
    }
  }

  // Nothing to resolve
  if (sharedGroupIds.size === 0) {
    return cases;
  }

  // Batch-fetch all shared step items for the referenced groups
  const sharedItems = await prisma.sharedStepItem.findMany({
    where: {
      sharedStepGroupId: { in: [...sharedGroupIds] },
      sharedStepGroup: { isDeleted: false },
    },
    orderBy: { order: "asc" },
  });

  // Group items by sharedStepGroupId
  const itemsByGroup = new Map<number, typeof sharedItems>();
  for (const item of sharedItems) {
    let group = itemsByGroup.get(item.sharedStepGroupId);
    if (!group) {
      group = [];
      itemsByGroup.set(item.sharedStepGroupId, group);
    }
    group.push(item);
  }

  // Expand shared step references in each case's steps array
  return cases.map((c) => {
    const steps = c.steps;
    if (!steps || steps.length === 0) return c;

    const resolvedSteps: StepWithSharedRef[] = [];

    for (const step of steps) {
      if (
        step.sharedStepGroupId != null &&
        itemsByGroup.has(step.sharedStepGroupId)
      ) {
        // Replace placeholder with expanded shared step items
        const items = itemsByGroup.get(step.sharedStepGroupId)!;
        for (const item of items) {
          resolvedSteps.push({
            id: item.id,
            step: item.step,
            expectedResult: item.expectedResult,
            order: step.order,
            isDeleted: false,
            sharedStepGroupId: null,
          });
        }
      } else if (step.sharedStepGroupId != null) {
        // Shared group was deleted or has no items — skip the placeholder
        continue;
      } else {
        // Regular step — pass through
        resolvedSteps.push(step);
      }
    }

    return { ...c, steps: resolvedSteps };
  });
}
