import { NextResponse } from "next/server";

/**
 * GET /api/config/review-feature
 *
 * Returns the resolved system-level review-feature flag, read server-side from
 * the operator-controlled `TESTPLANIT_REVIEW_FEATURE_ENABLED` env var.
 *
 * Per D-19 and RESEARCH §Pitfall 2: the env var MUST NOT be `NEXT_PUBLIC_*`
 * (no client-bundle leak); this route is the single place clients read the
 * resolved boolean from.
 *
 * Env var convention (Assumption A6, matches assertReviewGatePasses in
 * lib/services/reviewGate.ts): only the literal string 'false' disables the
 * feature. undefined / 'true' / '0' / 'no' / '' / any other value → enabled.
 *
 * No cache headers: operators expect a restart to apply env-var changes.
 * `force-dynamic` matches the existing `/api/config/trial` pattern so the
 * value is always evaluated against the current runtime env.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = process.env.TESTPLANIT_REVIEW_FEATURE_ENABLED !== "false";

  return NextResponse.json({ enabled });
}
