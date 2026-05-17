import type { Prisma } from "@prisma/client";

/**
 * AppConfig key that stores the system-level review-feature kill switch.
 *
 * Value semantics (deliberately mirrors the previous env-var convention):
 *   - row missing       → enabled (default-on; no-op for installations that
 *                         haven't seeded the row yet)
 *   - value === false   → disabled (the literal JSON boolean false)
 *   - anything else     → enabled
 */
export const REVIEW_FEATURE_FLAG_KEY = "review_feature_enabled";

/**
 * Read the system-level review-feature flag from the AppConfig table.
 *
 * Server-side helper used by:
 *   - `assertReviewGatePasses` in `lib/services/reviewGate.ts`
 *   - `decideReviewRequest` in `lib/services/reviewDecisions.ts`
 *   - the milestone-completion preflight in `app/actions/milestoneActions.ts`
 *
 * Accepts either a Prisma transaction client or the singleton `prisma` (any
 * client exposing the `appConfig` delegate). Callers in transactional contexts
 * should pass the `tx` handle so the read participates in the surrounding
 * transaction's snapshot isolation; non-transactional callers can pass
 * `prisma` directly.
 *
 * Default-on semantics: when the AppConfig row is absent (e.g. fresh install
 * before the seed has run) the feature is treated as enabled. This matches
 * the previous env-var convention where only the literal string `"false"`
 * disabled the feature. The same row missing on a configured install is
 * extremely unlikely — the seed creates it at install time — so the
 * default-on choice optimizes for the common case.
 */
export async function isReviewFeatureSystemEnabled(
  tx: Pick<Prisma.TransactionClient, "appConfig">
): Promise<boolean> {
  const row = await tx.appConfig.findUnique({
    where: { key: REVIEW_FEATURE_FLAG_KEY },
    select: { value: true },
  });
  if (!row) return true;
  return row.value !== false;
}
