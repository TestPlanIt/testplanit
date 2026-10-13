/**
 * The single shared expression of "is this case<->requirement linkage
 * suspect" (COV-05, D-03/D-04/D-05). Suspect is a COMPUTED state, never a
 * stored boolean — this predicate IS the whole feature: re-executing a case
 * clears the flag for free (no bookkeeping write), because the next read
 * simply recomputes false.
 *
 * `contentUpdatedAt` is stamped ONLY by the `tpl_issue_content_updated_at_upd`
 * Postgres trigger over `title`/`description`/`note` (D-01/D-02) — status,
 * priority, reparent, and attachment changes deliberately do not arm it. Do
 * not widen what "content" means here; that decision lives in the trigger,
 * not in this predicate.
 *
 * `lastExecutedAt` must originate from `getCaseLatestExecutedAt`
 * (lib/services/latestCaseResults.ts) or the requirement covering-cases
 * route — both compose the shared `latestCaseResultsCte()` fragment — and
 * never from `lib/services/latestTestResults.ts`'s `queryLatestTestResults`,
 * a deliberately different definition of "latest" for a different pair of
 * product surfaces.
 *
 * PURE module: zero imports, mirroring `issueRoleScope.ts`'s shape, so it is
 * equally safe on the server and inside a client component.
 */

/** Every field accepts both `Date` and an ISO string, since the two panels
 * that construct this input get their timestamps from different tiers: the
 * requirement-side covering-cases route hands back ISO strings, the
 * case-side panel gets `Date` values straight from a ZenStack hook. */
export interface SuspectLinkageInput {
  contentUpdatedAt: Date | string | null | undefined;
  lastExecutedAt: Date | string | null | undefined;
  suspectDismissedAt: Date | string | null | undefined;
}

/** Converts a value to epoch milliseconds, returning `null` for an absent
 * or unparseable value — so an unparseable timestamp short-circuits to
 * false rather than producing a NaN comparison anywhere below. */
function toEpochMillis(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const millis =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(millis) ? null : millis;
}

/**
 * A linkage is suspect iff the case HAS a latest execution AND
 * `contentUpdatedAt` is strictly greater than `lastExecutedAt` AND
 * (`suspectDismissedAt` is absent OR `contentUpdatedAt` is strictly greater
 * than `suspectDismissedAt`). Strict `>` in both comparisons — an equal
 * timestamp is NOT suspect.
 */
export function isLinkageSuspect(input: SuspectLinkageInput): boolean {
  const lastExecutedAtMs = toEpochMillis(input.lastExecutedAt);
  if (lastExecutedAtMs === null) {
    // D-04: nothing to invalidate — the rollup already renders a
    // never-executed case Untested.
    return false;
  }

  const contentUpdatedAtMs = toEpochMillis(input.contentUpdatedAt);
  if (contentUpdatedAtMs === null) {
    // The requirement has never had a real content edit since the
    // migration (or the value could not be parsed).
    return false;
  }

  if (!(contentUpdatedAtMs > lastExecutedAtMs)) {
    // D-05: re-execution at or after the content edit auto-clears the
    // flag, with zero bookkeeping — the next read simply recomputes false.
    return false;
  }

  const suspectDismissedAtMs = toEpochMillis(input.suspectDismissedAt);
  if (suspectDismissedAtMs === null) {
    return true;
  }

  // D-05: a newer content edit re-arms a dismissed flag.
  return contentUpdatedAtMs > suspectDismissedAtMs;
}
