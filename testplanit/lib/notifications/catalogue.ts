import { NotificationType } from "~/zenstack/models";

/**
 * The notification catalogue: one entry per `NotificationType`.
 *
 * It is the single description of what each type is and how a user may
 * configure it. The preferences page, the delivery pipeline and the docs
 * read from it; `catalogue.test.ts` fails when the enum and this list
 * disagree, or when a non-retired type has no translation or bell branch.
 *
 * Translation keys are derived by convention under
 * `users.profile.notifications`: `groups.<group>` for a group heading and
 * `types.<TYPE>.label` / `types.<TYPE>.description` for a row.
 */

export const NOTIFICATION_GROUPS = [
  "assignments",
  "comments",
  "reviews",
  "runsAndMilestones",
  "sharing",
  "aiAndJobs",
  "integrations",
  "system",
  "administration",
] as const;

export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export type NotificationAudience = "everyone" | "admin";

export interface NotificationCatalogueEntry {
  type: NotificationType;
  /** Section the type is listed under on the preferences page. */
  group: NotificationGroup;
  /** Who can receive it. Admin-only types are shown only to admins. */
  audience: NotificationAudience;
  /**
   * Whether a user may switch the type off. A locked type (`false`) is
   * delivered regardless of the muted set, even when a stale value is
   * present in it.
   */
  optional: boolean;
  /**
   * Kept in the enum so existing rows stay readable, but never created,
   * never shown on the preferences page and never counted.
   */
  retired?: true;
}

export const NOTIFICATION_CATALOGUE: readonly NotificationCatalogueEntry[] = [
  // Assignments
  {
    type: NotificationType.WORK_ASSIGNED,
    group: "assignments",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.SESSION_ASSIGNED,
    group: "assignments",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.RUN_CASE_UNBLOCKED,
    group: "assignments",
    audience: "everyone",
    optional: true,
  },
  // Comments
  {
    type: NotificationType.COMMENT_MENTION,
    group: "comments",
    audience: "everyone",
    optional: true,
  },
  // Reviews
  {
    type: NotificationType.REVIEW_REQUESTED,
    group: "reviews",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.REVIEW_APPROVED,
    group: "reviews",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.REVIEW_CHANGES_REQUESTED,
    group: "reviews",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.REVIEW_REJECTED,
    group: "reviews",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.REVIEW_CANCELLED,
    group: "reviews",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.REVIEW_REMINDER,
    group: "reviews",
    audience: "everyone",
    optional: true,
  },
  // Runs and milestones
  {
    type: NotificationType.RUN_READY_TO_COMPLETE,
    group: "runsAndMilestones",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.MILESTONE_DUE_REMINDER,
    group: "runsAndMilestones",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.ALERT_TRIGGERED,
    group: "runsAndMilestones",
    audience: "everyone",
    optional: true,
  },
  // Sharing
  {
    type: NotificationType.SHARE_LINK_ACCESSED,
    group: "sharing",
    audience: "everyone",
    optional: true,
  },
  // AI and jobs
  {
    type: NotificationType.AI_STEPS_DERIVED,
    group: "aiAndJobs",
    audience: "everyone",
    optional: true,
  },
  {
    type: NotificationType.CASES_DRAFTED,
    group: "aiAndJobs",
    audience: "everyone",
    optional: true,
  },
  // Integrations — an expired credential blocks the user's own syncs.
  {
    type: NotificationType.INTEGRATION_AUTH_EXPIRED,
    group: "integrations",
    audience: "everyone",
    optional: false,
  },
  // System — an admin broadcast is the one channel that reaches everyone.
  {
    type: NotificationType.SYSTEM_ANNOUNCEMENT,
    group: "system",
    audience: "everyone",
    optional: false,
  },
  {
    type: NotificationType.WHATS_NEW,
    group: "system",
    audience: "everyone",
    optional: true,
  },
  // Administration
  {
    type: NotificationType.USER_REGISTERED,
    group: "administration",
    audience: "admin",
    optional: true,
  },
  // Retired
  // AI budget alerts are raised by AI-budget alert rules (ALERT_TRIGGERED)
  // since the #651 follow-up; rows of this type only predate it.
  {
    type: NotificationType.LLM_BUDGET_ALERT,
    group: "administration",
    audience: "admin",
    optional: true,
    retired: true,
  },
  {
    type: NotificationType.COPY_MOVE_COMPLETE,
    group: "aiAndJobs",
    audience: "everyone",
    optional: true,
    retired: true,
  },
  {
    type: NotificationType.GENERATE_FROM_URL_COMPLETE,
    group: "aiAndJobs",
    audience: "everyone",
    optional: true,
    retired: true,
  },
];

const entriesByType = new Map<string, NotificationCatalogueEntry>(
  NOTIFICATION_CATALOGUE.map((entry) => [entry.type, entry])
);

export function getNotificationCatalogueEntry(
  type: string
): NotificationCatalogueEntry | undefined {
  return entriesByType.get(type);
}

/** A type the user may not switch off. Unknown types are treated as locked. */
export function isLockedNotificationType(type: string): boolean {
  const entry = entriesByType.get(type);
  return entry ? !entry.optional : true;
}

export function isRetiredNotificationType(type: string): boolean {
  return entriesByType.get(type)?.retired === true;
}

/**
 * The entries a user can see on their preferences page: never retired,
 * and admin-only types only for admins.
 */
export function getConfigurableNotificationTypes(options: {
  isAdmin: boolean;
}): NotificationCatalogueEntry[] {
  return NOTIFICATION_CATALOGUE.filter(
    (entry) =>
      !entry.retired && (entry.audience === "everyone" || options.isAdmin)
  );
}

/** Same as `getConfigurableNotificationTypes`, grouped in catalogue order. */
export function getConfigurableNotificationGroups(options: {
  isAdmin: boolean;
}): Array<{ group: NotificationGroup; entries: NotificationCatalogueEntry[] }> {
  const entries = getConfigurableNotificationTypes(options);
  return NOTIFICATION_GROUPS.map((group) => ({
    group,
    entries: entries.filter((entry) => entry.group === group),
  })).filter((section) => section.entries.length > 0);
}

export interface MutedNotificationPreferences {
  mutedNotificationTypes?: readonly string[] | null;
}

/**
 * Whether the recipient has opted out of `type`.
 *
 * Only an optional, non-retired type can be muted; a locked type ignores the
 * muted set even when a stale value is present in it. A missing preferences
 * row means nothing is muted.
 */
export function isNotificationMuted(
  preferences: MutedNotificationPreferences | null | undefined,
  type: string
): boolean {
  const entry = entriesByType.get(type);
  if (!entry || !entry.optional) return false;
  const muted = preferences?.mutedNotificationTypes;
  if (!muted || muted.length === 0) return false;
  return muted.includes(type);
}
