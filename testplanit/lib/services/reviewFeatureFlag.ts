import type { Prisma } from "@prisma/client";

/**
 * AppConfig key that stores the system-level review-feature kill switch.
 *
 * Value semantics:
 *   - row missing       → disabled (default-off; admin must opt in via
 *                         Admin → Workflows → System Feature card)
 *   - value === true    → enabled
 *   - anything else     → disabled
 */
export const REVIEW_FEATURE_FLAG_KEY = "review_feature_enabled";

/**
 * Read the system-level review-feature flag from the AppConfig table.
 *
 * Server-side helper used by:
 *   - `assertReviewGatePasses` in `lib/services/reviewGate.ts`
 *   - `requestReview` in `app/actions/reviews.ts`
 *   - `decideReviewRequest` / `cancelReviewRequest` in `lib/services/reviewDecisions.ts`
 *   - the milestone-completion preflight in `app/actions/milestoneActions.ts`
 *
 * Accepts either a Prisma transaction client or the singleton `prisma` (any
 * client exposing the `appConfig` delegate). Callers in transactional contexts
 * should pass the `tx` handle so the read participates in the surrounding
 * transaction's snapshot isolation; non-transactional callers can pass
 * `prisma` directly.
 *
 * Default-off semantics: when the AppConfig row is absent the feature is
 * treated as disabled. Review & Approval gates every workflow transition
 * into a gated state and that is a meaningful behavior change for every
 * existing project — turning it on by default would surprise admins on
 * upgrade. Admins opt in by flipping the system kill switch on, then per
 * project via Project Settings → Advanced.
 */
export async function isReviewFeatureSystemEnabled(
  tx: Pick<Prisma.TransactionClient, "appConfig">
): Promise<boolean> {
  const row = await tx.appConfig.findUnique({
    where: { key: REVIEW_FEATURE_FLAG_KEY },
    select: { value: true },
  });
  if (!row) return false;
  return row.value === true;
}
