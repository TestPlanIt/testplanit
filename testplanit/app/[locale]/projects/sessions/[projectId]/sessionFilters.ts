/**
 * Session-list filter state, kept apart from the chip UI so the semantics
 * below can be reasoned about (and tested) on their own.
 *
 * "My Sessions" = the signed-in user created the session or it is assigned to
 * them — the two roles the row's contributor avatars credit (see SessionItem's
 * MemberList). The runs page's third role, "recorded a result", has no session
 * analogue on the row: a session's results are all authored under its single
 * assignee, so it would credit nobody the row doesn't already name.
 */
export interface SessionFilters {
  mine: boolean;
}

export const EMPTY_SESSION_FILTERS: SessionFilters = {
  mine: false,
};

export const sessionFiltersStorageKey = (projectId: string | number) =>
  `tpi.sessions.${projectId}.filters`;

/** Whether the list is narrowed at all — drives the "no matches" copy. */
export function isAnySessionFilterActive(filters: SessionFilters): boolean {
  return filters.mine;
}

/** Whether a session counts as the signed-in user's own. */
export function isMySession(
  session: { createdById?: string | null; assignedToId?: string | null },
  userId: string | undefined | null
): boolean {
  if (!userId) return false;
  return session.createdById === userId || session.assignedToId === userId;
}

/**
 * Reads persisted filters, tolerating anything the key might hold: absent,
 * unparseable, or a stale shape from an older build. Every field is coerced
 * rather than trusted, so a bad value degrades to "off" instead of poisoning
 * the query with a non-boolean.
 */
export function parseStoredSessionFilters(
  stored: string | null
): SessionFilters {
  if (!stored) return EMPTY_SESSION_FILTERS;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return EMPTY_SESSION_FILTERS;
    const value = parsed as Partial<SessionFilters>;
    return {
      mine: value.mine === true,
    };
  } catch {
    return EMPTY_SESSION_FILTERS;
  }
}
