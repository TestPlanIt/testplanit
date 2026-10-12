/**
 * A delivery's `error` holds either a failure or a note that the event was
 * handled but acted on nothing (an issue no rule imports, a run with no
 * cases). Notes start with "ignored:" and don't count as failures.
 */
export const IGNORED_NOTE_PREFIX = "ignored:";

export function isIgnoredDeliveryNote(
  error: string | null | undefined
): boolean {
  return typeof error === "string" && error.startsWith(IGNORED_NOTE_PREFIX);
}

/** Deliveries whose `error` is an ignored note, as a where clause. */
export const IGNORED_DELIVERY_NOTE_WHERE = {
  error: { startsWith: IGNORED_NOTE_PREFIX },
};

/** Deliveries that failed: an error that isn't an ignored note. */
export const FAILED_DELIVERY_WHERE = {
  error: { not: null },
  NOT: IGNORED_DELIVERY_NOTE_WHERE,
};

/** Deliveries handled without failing. */
export const SUCCEEDED_DELIVERY_WHERE = {
  OR: [{ error: null }, IGNORED_DELIVERY_NOTE_WHERE],
};
