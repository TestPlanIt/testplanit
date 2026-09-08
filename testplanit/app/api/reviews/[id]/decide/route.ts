import type { Session } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import {
  decideReviewRequest,
  type DecideOutcome,
} from "~/lib/services/reviewDecisions";
import {
  isFeatureDisabledError,
  isIneligibleReviewerError,
  isNotFoundError,
} from "~/lib/utils/errors";
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

    // Session cookie first, Bearer API token second — the same ladder the
    // attachment and whoami routes use. The token path exists so an MCP
    // agent can decide on its owner's behalf; every eligibility rule in
    // `decideReviewRequest` still applies, because the token resolves to
    // that user and to nothing more. `authenticateApiTokenForMethod`
    // rejects a `mode:read` token here (POST), so a read-only agent token
    // cannot record a decision.
    let session = await getServerAuthSession();
    if (!session) {
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

      // `decideReviewRequest` reads `user.id` (the actor), `user.access`
      // (the system-ADMIN override) and `user.name` (the decider name on
      // the paired comment, the notification, and the webhook payload), so
      // the token identity is widened to those three fields here rather
      // than reshaping the service's signature for one caller.
      const tokenUser = await baseDb.user.findUnique({
        where: { id: apiAuth.userId },
        select: { id: true, name: true, email: true, access: true },
      });
      if (!tokenUser) {
        return NextResponse.json(
          { error: { code: "INVALID_TOKEN", message: "User not found" } },
          { status: 401 }
        );
      }

      enrichFromApiAuth({
        userId: tokenUser.id,
        userEmail: tokenUser.email ?? undefined,
        userName: tokenUser.name ?? undefined,
        scopes: apiAuth.scopes,
      });

      session = {
        user: {
          id: tokenUser.id,
          name: tokenUser.name,
          email: tokenUser.email,
          access: tokenUser.access,
        },
        // Not consulted by the service; the token's own expiry was already
        // enforced during authentication.
        expires: new Date().toISOString(),
      } satisfies Session;
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
      // The system kill switch or the project's review toggle is off — a
      // decision is simply not a thing that can be recorded, which is a
      // 403, not the 500 this used to fall through to.
      if (isFeatureDisabledError(error)) {
        return NextResponse.json(
          { error: { code: "FEATURE_DISABLED" } },
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
