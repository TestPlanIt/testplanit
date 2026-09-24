import { getServerSession } from "next-auth/next";
import { internalReportBypassToken } from "~/lib/internalReportBypass";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { frozenReportMeta } from "~/lib/reports/frozenReportMeta";
import { verifyShareAccessToken } from "~/lib/shareAccessToken";
import {
  buildSharedReportPayload,
  callerAuthHeaders,
} from "~/lib/reports/sharedReportPayload";
import { authOptions } from "~/server/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/share/[shareKey]/report
 * Fetch report data for a shared link (public access)
 * This endpoint is accessible without authentication for PUBLIC and PASSWORD_PROTECTED shares
 */
export const GET = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ shareKey: string }> }
  ) => {
    try {
      const { shareKey } = await params;
      const session = await getServerSession(authOptions);

      // Get token from query params (for password-protected shares)
      const { searchParams } = new URL(req.url);
      const token = searchParams.get("token");

      // Fetch share link
      const shareLink = await baseDb.shareLink.findUnique({
        where: { shareKey },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              createdBy: true,
              userPermissions: {
                where: session?.user?.id
                  ? { userId: session.user.id }
                  : undefined,
              },
            },
          },
          snapshot: {
            include: { capturedBy: { select: { name: true } } },
          },
        },
        // passwordHash is @omit; the access token is bound to it.
        omit: { passwordHash: false },
      });

      if (
        !shareLink ||
        shareLink.isDeleted ||
        // A saved report is private to the user who saved it.
        (shareLink.entityType === "SAVED_REPORT" &&
          shareLink.createdById !== session?.user?.id)
      ) {
        return NextResponse.json(
          { error: "Share link not found" },
          { status: 404 }
        );
      }

      // Check if revoked
      if (shareLink.isRevoked) {
        return NextResponse.json(
          { error: "This share link has been revoked" },
          { status: 403 }
        );
      }

      // Check if expired
      if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
        return NextResponse.json(
          { error: "This share link has expired" },
          { status: 403 }
        );
      }

      // Handle PASSWORD_PROTECTED mode
      if (shareLink.mode === "PASSWORD_PROTECTED") {
        const hasValidToken = verifyShareAccessToken(
          token,
          shareKey,
          shareLink.passwordHash
        );
        // Check if user has project access (bypass password)
        if (session) {
          const hasProjectAccess =
            session.user.access === "ADMIN" ||
            !shareLink.project ||
            shareLink.project.createdBy === session.user.id ||
            shareLink.project.userPermissions.length > 0;

          if (!hasProjectAccess && !hasValidToken) {
            return NextResponse.json(
              { error: "Valid token required" },
              { status: 401 }
            );
          }
        } else {
          // Not logged in, require valid token
          if (!hasValidToken) {
            return NextResponse.json(
              { error: "Valid token required" },
              { status: 401 }
            );
          }
        }
      }

      // Handle AUTHENTICATED mode
      if (shareLink.mode === "AUTHENTICATED") {
        if (!session) {
          return NextResponse.json(
            { error: "Authentication required" },
            { status: 401 }
          );
        }

        const hasProjectAccess =
          session.user.access === "ADMIN" ||
          !shareLink.project ||
          shareLink.project.createdBy === session.user.id ||
          shareLink.project.userPermissions.length > 0;

        if (!hasProjectAccess) {
          return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }
      }

      if (
        shareLink.entityType !== "REPORT" &&
        shareLink.entityType !== "SAVED_REPORT"
      ) {
        return NextResponse.json(
          { error: "Only report shares are supported" },
          { status: 400 }
        );
      }

      // A frozen link serves the output captured when it was created and
      // never runs the report again.
      if (shareLink.snapshot) {
        return NextResponse.json({
          ...(shareLink.snapshot.payload as Record<string, unknown>),
          frozen: frozenReportMeta(shareLink.snapshot),
        });
      }

      const config = shareLink.entityConfig as any;
      const isSavedReport = shareLink.entityType === "SAVED_REPORT";
      const result = await buildSharedReportPayload({
        config,
        // Saved reports keep their project inside the config (the row itself
        // has none, which keeps it private).
        projectId:
          shareLink.projectId ??
          (isSavedReport && Number.isInteger(config?.projectId)
            ? config.projectId
            : null),
        // A saved report runs as its owner, with the owner's current
        // permissions. A share link is itself the read grant, so its internal
        // fetches carry the share-replay token instead of user credentials.
        authHeaders: isSavedReport
          ? callerAuthHeaders(req)
          : { "x-shared-report-bypass": internalReportBypassToken() },
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json(result.payload);
    } catch (error) {
      console.error("Error fetching report data for share:", error);
      return NextResponse.json(
        { error: "Failed to load report data" },
        { status: 500 }
      );
    }
  }
);
