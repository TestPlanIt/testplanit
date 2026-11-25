/**
 * Deterministic id of the "Deleted User" row. Purging a user from Admin > Trash
 * hands everything they created to this row, so the content survives the
 * purge. The row is itself soft-deleted, which makes every screen show its
 * content the way it already shows a deleted user's.
 */
export const DELETED_USER_ID = "system-deleted-user" as const;

/** Sentinel email of the "Deleted User" row. Not a deliverable address. */
export const DELETED_USER_EMAIL = "deleted@__system__" as const;

export const DELETED_USER_NAME = "Deleted User" as const;
