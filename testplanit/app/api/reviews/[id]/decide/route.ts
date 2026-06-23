import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { withAuditContext } from "~/lib/auditContextWrappers";
import {
  decideReviewRequest,
  type DecideOutcome,
} from "~/lib/services/reviewDecisions";
import { isIneligibleReviewerError, isNotFoundError } from "~/lib/utils/errors";
import { getServerAuthSession } from "~/server/auth";

/**
 * Body schema for POST /api/reviews/[id]/decide.
 *
 * `comment` is required for `CHANGES_REQUESTED` and `REJECTED` per the
 * REVIEWER-04 / REVIEWER-05 wording (reviewer must explain the rejection
 * or what changes are required). For `APPROVED` the comment is optional
 * (D-13 approval-note pattern). Server-side error messages stay in
 * English per the project memory rule.
 */
const decideBodySchema = z
  .object({
    decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
    comment: z.string().optional(),
  })
  .refine(
    (data) =>
      data.decision === "APPROVED" || (data.comment?.trim().length ?? 0) > 0,
    {
      message:
        "Comment is required for CHANGES_REQUESTED and REJECTED decisions",
      path: ["comment"],
    }
  );

export const POST = withAuditContext(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const routeParams = await context.params;
    const reviewRequestId = routeParams.id;

    const session = await getServerAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Request body must be valid JSON",
          },
        },
        { status: 400 }
      );
    }

    const parsed = decideBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BODY",
            details: parsed.error.issues,
          },
        },
        { status: 400 }
      );
    }

    const { decision, comment } = parsed.data;

    try {
      const updated = await decideReviewRequest(
        session,
        reviewRequestId,
        decision as DecideOutcome,
        comment
      );
      return NextResponse.json(updated, { status: 200 });
    } catch (error) {
      if (isIneligibleReviewerError(error)) {
        return NextResponse.json(
          { error: { code: "INELIGIBLE_REVIEWER" } },
          { status: 403 }
        );
      }
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("already decided")
      ) {
        return NextResponse.json(
          { error: { code: "ALREADY_DECIDED" } },
          { status: 409 }
        );
      }
      if (isNotFoundError(error)) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND" } },
          { status: 404 }
        );
      }
      console.error("Error deciding review request:", error);
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR" } },
        { status: 500 }
      );
    }
  }
);
