/**
 * Deterministic id of the seeded System user. Webhook actions and other
 * unattended automation create records as this user, so nobody's name
 * appears on work they didn't do.
 */
export const SYSTEM_AUTOMATION_USER_ID = "system-automation-user" as const;

/**
 * Sentinel email of the System user. The admin Users page matches this exact
 * value to badge the row and lock it against edits.
 */
export const SYSTEM_AUTOMATION_USER_EMAIL = "automation@__system__" as const;
