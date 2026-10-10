import { NextRequest, NextResponse } from "next/server";

import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import {
  resolveReviewAssigneeScope,
  reviewAssigneeWhere,
} from "~/lib/services/reviewInboxScope";
import { getServerAuthSession } from "~/server/auth";

/**
 * GET /api/reviews/assignee-scope
 *
 * The caller's review-assignee scope: the per-project roles they can be
 * reached through, with the entity types those roles may approve, plus the
 * ready-made `where` branches. The inbox page, its badges and the MCP
 * server all query review requests with this, so what they list is exactly
 * what `decideReviewRequest` lets the caller decide. Always the caller's
 * own scope; there is no way to ask for another user's.
 */
export async function GET(request: NextRequest) {
  let userId: string | undefined = (await getServerAuthSession())?.user?.id;
  if (!userId) {
    if (!extractBearerToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const apiAuth = await authenticateApiTokenForMethod(request);
    if (!apiAuth.authenticated || !apiAuth.userId) {
      return NextResponse.json(
        {
          error: {
            code: apiAuth.errorCode ?? "UNAUTHORIZED",
            message: apiAuth.error ?? "Unauthorized",
          },
        },
        { status: 401 }
      );
    }
    userId = apiAuth.userId;
  }

  const scope = await resolveReviewAssigneeScope(userId, baseDb as any);
  return NextResponse.json({ ...scope, where: reviewAssigneeWhere(scope) });
}
