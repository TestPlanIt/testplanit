import { isNotificationMuted, MutedNotificationPreferences } from "./catalogue";

/** The mode a notification is actually delivered under, after USE_GLOBAL is resolved. */
export type EffectiveNotificationMode =
  "NONE" | "IN_APP" | "IN_APP_EMAIL_IMMEDIATE" | "IN_APP_EMAIL_DAILY";

export interface DeliveryPreferences extends MutedNotificationPreferences {
  notificationMode?: string | null;
}

/**
 * Resolve a user's effective notification mode. `USE_GLOBAL` (also the mode
 * implied by a missing preferences row) falls through to the admin default
 * stored under the `notificationSettings` AppConfig key, which itself
 * defaults to `IN_APP`.
 */
export function resolveEffectiveNotificationMode(
  preferences: DeliveryPreferences | null | undefined,
  globalSettingsValue: unknown
): EffectiveNotificationMode {
  const mode = preferences?.notificationMode || "USE_GLOBAL";
  if (mode !== "USE_GLOBAL") return mode as EffectiveNotificationMode;
  const defaultMode = (globalSettingsValue as { defaultMode?: string } | null)
    ?.defaultMode;
  return (defaultMode || "IN_APP") as EffectiveNotificationMode;
}

export type NotificationDeliveryDecision =
  | { deliver: true; mode: EffectiveNotificationMode }
  | {
      deliver: false;
      mode: EffectiveNotificationMode;
      reason: "mode_none" | "muted";
    };

/**
 * The one delivery check every path applies before creating a notification
 * row: the mode decides whether the user is reached at all, the muted set
 * decides whether they want this type. Because the row is never created
 * when the answer is no, the bell, the immediate email and the daily digest
 * are all covered by this single decision.
 */
export function decideNotificationDelivery(params: {
  preferences: DeliveryPreferences | null | undefined;
  globalSettingsValue: unknown;
  type: string;
}): NotificationDeliveryDecision {
  const mode = resolveEffectiveNotificationMode(
    params.preferences,
    params.globalSettingsValue
  );
  if (mode === "NONE") return { deliver: false, mode, reason: "mode_none" };
  if (isNotificationMuted(params.preferences, params.type)) {
    return { deliver: false, mode, reason: "muted" };
  }
  return { deliver: true, mode };
}
