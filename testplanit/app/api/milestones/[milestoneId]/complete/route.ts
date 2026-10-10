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
import { completeMilestoneWithCascade } from "~/lib/services/milestoneCompletion";
import { getServerAuthSession } from "~/server/auth";
import { toCalendarDate } from "~/utils/calendarDate";

/**
 * POST /api/milestones/[milestoneId]/complete
 *
 * Completes a milestone the way the Complete dialog does: the planned due
 * date becomes the completion date unless one is given, descendant
 * milestones complete with it, and — when asked — so do its active runs
 * and sessions, subject to the caller's canClose permissions and the
 * review gate. Without `force`, a milestone with active work returns
 * `confirmation_required` and an impact count instead of completing.
 *
 * Accepts a session cookie or a Bearer API token, so the MCP server and
 * other API clients complete milestones through the same writer as the app.
 */
const bodySchema = z.object({
  /** YYYY-MM-DD; defaults to the milestone's due date, else today. */
  completionDate: z.iso.date().optional(),
  /** Complete even when active runs, sessions or child milestones exist. */
  force: z.boolean().optional(),
  completeTestRuns: z.boolean().optional(),
  completeSessions: z.boolean().optional(),
  testRunStateId: z.number().int().positive().nullable().optional(),
  sessionStateId: z.number().int().positive().nullable().optional(),
});

export const POST = withAuditContext(
  async (
    request: NextRequest,
    context: { params: Promise<{ milestoneId: string }> }
  ) => {
    const { milestoneId: rawId } = await context.params;
    const milestoneId = Number(rawId);
    if (!Number.isInteger(milestoneId) || milestoneId <= 0) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid milestone id" } },
        { status: 400 }
      );
    }

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
        expires: new Date().toISOString(),
      } satisfies Session;
    }

    let rawBody: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) rawBody = JSON.parse(text);
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
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_BODY", details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const milestone = await baseDb.milestones.findUnique({
      where: { id: milestoneId, isDeleted: false },
      select: {
        id: true,
        completedAt: true,
        integrationId: true,
        detachedAt: true,
      },
    });
    if (!milestone) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Milestone not found" } },
        { status: 404 }
      );
    }
    if (milestone.integrationId != null && milestone.detachedAt == null) {
      return NextResponse.json(
        {
          error: {
            code: "TRACKER_OWNED",
            message:
              "This milestone is synced from an external tracker; complete it there.",
          },
        },
        { status: 422 }
      );
    }

    const completionDate = parsed.data.completionDate
      ? new Date(`${parsed.data.completionDate}T00:00:00.000Z`)
      : (milestone.completedAt ?? toCalendarDate(new Date()));

    const result = await completeMilestoneWithCascade(session, {
      milestoneId,
      completionDate,
      forceCompleteDependencies: parsed.data.force ?? false,
      completeTestRuns: parsed.data.completeTestRuns,
      completeSessions: parsed.data.completeSessions,
      testRunStateId: parsed.data.testRunStateId,
      sessionStateId: parsed.data.sessionStateId,
    });

    if (result.status === "error") {
      const forbidden = result.message?.includes("permission");
      return NextResponse.json(
        {
          error: {
            code: forbidden ? "FORBIDDEN" : "COMPLETION_FAILED",
            message: result.message,
          },
        },
        { status: forbidden ? 403 : 422 }
      );
    }
    return NextResponse.json(result);
  }
);
