import { z } from "zod";

/**
 * Per-project mapping from an issue-priority string (whatever vocabulary the
 * project's tracker or team uses) to a 0-100 criticality weight. No
 * vocabulary is built into the product: an unmapped string counts neutral,
 * so linked requirements and defects still signal presence without anyone
 * configuring anything.
 */

export const NEUTRAL_PRIORITY_WEIGHT = 50;

export const MAX_PRIORITY_WEIGHT_ENTRIES = 200;
export const MAX_PRIORITY_NAME_LENGTH = 100;

const weightValue = z.number().min(0).max(100);

const weightEntrySchema = z.tuple([
  z.string().min(1).max(MAX_PRIORITY_NAME_LENGTH),
  weightValue,
]);

export const riskPriorityWeightsSchema = z
  .record(z.string().min(1).max(MAX_PRIORITY_NAME_LENGTH), weightValue)
  .refine((map) => Object.keys(map).length <= MAX_PRIORITY_WEIGHT_ENTRIES);

export function normalizePriorityName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Never throws, and lenient per entry: an unusable entry is skipped rather
 * than disabling the whole mapping, and entries beyond the cap are ignored.
 */
export function resolvePriorityWeights(value: unknown): Map<string, number> {
  const resolved = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return resolved;
  }
  for (const entry of Object.entries(value)) {
    if (resolved.size >= MAX_PRIORITY_WEIGHT_ENTRIES) break;
    const parsed = weightEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const normalized = normalizePriorityName(parsed.data[0]);
    if (normalized) resolved.set(normalized, parsed.data[1]);
  }
  return resolved;
}

export function priorityWeightFor(
  priority: string | null | undefined,
  mapping: Map<string, number>
): number {
  if (!priority) return NEUTRAL_PRIORITY_WEIGHT;
  const normalized = normalizePriorityName(priority);
  if (!normalized) return NEUTRAL_PRIORITY_WEIGHT;
  return mapping.get(normalized) ?? NEUTRAL_PRIORITY_WEIGHT;
}

/**
 * Weight of a dropdown option by its position among the field's options,
 * top first: the first option counts 100, the last 10, evenly spaced. Order
 * is the admin-maintained semantic; names never matter.
 */
export function optionPositionWeight(position: number, count: number): number {
  if (count <= 1) return 100;
  const clamped = Math.min(Math.max(position, 0), count - 1);
  return Math.round(100 - (clamped * 90) / (count - 1));
}
