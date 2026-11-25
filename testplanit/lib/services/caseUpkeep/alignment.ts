/**
 * Whether a linked issue's text has changed since the test case was last
 * brought in line with it. Computed, never stored: aligning the case again
 * clears it, and a later change to the issue raises it again.
 *
 * A link that was never aligned (`alignedAt` absent) is never flagged: it
 * predates the tracking, and nothing says the case was ever written from
 * that issue's text.
 *
 * Pure, with no imports, so it is safe in a client component.
 */
export function isIssueTextNewerThanCase(input: {
  contentUpdatedAt: Date | string | null | undefined;
  alignedAt: Date | string | null | undefined;
}): boolean {
  const changed = toMillis(input.contentUpdatedAt);
  const aligned = toMillis(input.alignedAt);
  return changed !== null && aligned !== null && changed > aligned;
}

function toMillis(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const millis =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(millis) ? null : millis;
}
