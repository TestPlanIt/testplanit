import { NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";

/**
 * GET /api/config/review-feature
 *
 * Returns the resolved system-level review-feature flag, read from the
 * `review_feature_enabled` AppConfig row. Admins flip the row from the Admin
 * Workflows page; the value is reflected to all clients on the next refetch
 * (no restart required, unlike the prior env-var implementation).
 *
 * No cache headers — the value must reflect admin toggles immediately on the
 * next request. `force-dynamic` matches the existing `/api/config/trial`
 * pattern.
 */
export async function GET() {
  const enabled = await isReviewFeatureSystemEnabled(baseDb);
  return NextResponse.json({ enabled });
}
