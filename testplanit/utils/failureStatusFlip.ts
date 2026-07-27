/**
 * Auto-flip helpers for result screens: linking an issue to a test case result
 * means the tester found a defect, so the surface the issue was attached to
 * flips itself to the project's first failure status instead of making the
 * tester set it by hand.
 *
 * Both helpers are pure so the Add/Edit Result modals can call them straight
 * from the issue picker's change handler.
 */

export interface FlipCandidateStatus {
  id: number;
  isFailure: boolean;
  order: number;
}

/**
 * Whether `next` contains an issue id that `previous` did not. Unlinking an
 * issue, or re-emitting the same selection, never triggers a flip.
 */
export function hasNewlyLinkedIssue(
  previous: number[] | null | undefined,
  next: number[] | null | undefined
): boolean {
  if (!next?.length) return false;
  const previousIds = new Set(previous ?? []);
  return next.some((id) => !previousIds.has(id));
}

/**
 * The status a surface should flip to once an issue is linked to it, or null
 * to leave the current selection alone.
 *
 * Returns null when the project has no failure status, or when the surface
 * already carries one — a tester who picked a specific failure status keeps
 * it. Otherwise the lowest-`order` failure status wins, matching how the rest
 * of the app resolves "the first" status of a kind.
 */
export function failureFlipStatusId(
  currentStatusId: number | null | undefined,
  statuses: FlipCandidateStatus[] | null | undefined
): number | null {
  if (!statuses?.length) return null;

  const currentStatus =
    currentStatusId != null
      ? statuses.find((status) => status.id === currentStatusId)
      : undefined;
  if (currentStatus?.isFailure) return null;

  let flipTo: FlipCandidateStatus | null = null;
  for (const status of statuses) {
    if (!status.isFailure) continue;
    if (!flipTo || status.order < flipTo.order) {
      flipTo = status;
    }
  }
  return flipTo?.id ?? null;
}
