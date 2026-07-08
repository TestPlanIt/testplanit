import { NextRequest, NextResponse } from "next/server";

/**
 * NOT YET IMPLEMENTED — RED scaffold placeholder (18-01).
 *
 * This route intentionally has no real implementation yet. It exists only
 * so `route.test.ts`'s `import("./route")` resolves and the RED assertions
 * in that file fail against actual (missing) response behavior instead of
 * failing at module-resolution time. 18-05 implements the real descendant-
 * scoped coverage aggregation (D-04/D-05/D-06/D-15) described in
 * `.planning/phases/18-issue-membership/18-01-PLAN.md`.
 */
export async function GET(
  _req: NextRequest,
  _context: { params: Promise<{ milestoneId: string }> }
) {
  return NextResponse.json(
    { error: "Not implemented" },
    { status: 501 }
  );
}
