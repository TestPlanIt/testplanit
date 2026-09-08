/**
 * Milestones fields owned by the external tracker for synced milestones —
 * locked by `@deny('update', integrationId != null)` in schema.zmodel.
 * ZenStack's field-level deny rejects the ENTIRE update when a denied field
 * is merely present in the payload (it does not compare old vs. new values),
 * so the save path must strip these fields for synced milestones instead of
 * submitting the disabled inputs' values back.
 */
export const TRACKER_OWNED_MILESTONE_FIELDS = [
  "name",
  "note",
  "startedAt",
  "completedAt",
  "isStarted",
  "isCompleted",
] as const;

export type TrackerOwnedMilestoneField =
  (typeof TRACKER_OWNED_MILESTONE_FIELDS)[number];

export interface MilestoneUpdateFormValues {
  name: string;
  note?: string;
  docs?: string;
  isStarted: boolean;
  isCompleted: boolean;
  startedAt?: Date | null;
  completedAt?: Date | null;
  automaticCompletion: boolean;
  enableNotifications: boolean;
  notifyDaysBefore: number;
  milestoneTypesId: number;
  parentId?: number | null;
}

/**
 * Builds the `milestones.update` data payload from the milestone detail
 * form. When the milestone is synced (`integrationId != null`), the
 * tracker-owned fields are stripped so the update only carries local-owned
 * fields (type, parent, docs, notifications) — otherwise ZenStack rejects
 * the whole update via the field-level `@deny` locks.
 */
export function buildMilestoneUpdatePayload(
  data: MilestoneUpdateFormValues,
  isSynced: boolean
) {
  const { enableNotifications, ...restData } = data;
  const base = {
    ...restData,
    parentId: data.parentId ? Number(data.parentId) : null,
    automaticCompletion: data.completedAt ? data.automaticCompletion : false,
    notifyDaysBefore:
      data.completedAt && enableNotifications ? data.notifyDaysBefore : 0,
  };

  if (!isSynced) {
    return base;
  }

  const {
    name,
    note,
    startedAt,
    completedAt,
    isStarted,
    isCompleted,
    ...localFields
  } = base;
  return localFields;
}
