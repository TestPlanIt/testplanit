import { NextRequest, NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/share/[shareKey]/report
 * Fetch report data for a shared link (public access)
 * This endpoint is accessible without authentication for PUBLIC and PASSWORD_PROTECTED shares
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareKey: string }> }
) {
  try {
    const { shareKey } = await params;
    const session = await getServerSession(authOptions);

    // Get token from query params (for password-protected shares)
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    // Fetch share link
    const shareLink = await prisma.shareLink.findUnique({
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
      },
    });

    if (!shareLink) {
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
      // Check if user has project access (bypass password)
      if (session) {
        const hasProjectAccess =
          session.user.access === "ADMIN" ||
          !shareLink.project ||
          shareLink.project.createdBy === session.user.id ||
          shareLink.project.userPermissions.length > 0;

        if (!hasProjectAccess && token !== shareKey) {
          return NextResponse.json(
            { error: "Valid token required" },
            { status: 401 }
          );
        }
      } else {
        // Not logged in, require valid token
        if (token !== shareKey) {
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
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 }
        );
      }
    }

    // Only REPORT entity type is supported for now
    if (shareLink.entityType !== "REPORT") {
      return NextResponse.json(
        { error: "Only report shares are supported" },
        { status: 400 }
      );
    }

    const config = shareLink.entityConfig as any;
    if (!config) {
      return NextResponse.json(
        { error: "Invalid report configuration" },
        { status: 400 }
      );
    }

    // Import the report builder function
    const { buildReport } = await import("~/lib/services/reportBuilder");

    // Build the report
    const reportData = await buildReport({
      reportType: config.reportType,
      dimensions: config.dimensions || [],
      metrics: config.metrics || [],
      startDate: config.startDate ? new Date(config.startDate) : undefined,
      endDate: config.endDate ? new Date(config.endDate) : undefined,
      page: config.page || 1,
      pageSize: config.pageSize || 10,
      projectId: shareLink.projectId ?? undefined,
      userId: session?.user?.id,
    });

    return NextResponse.json(reportData);
  } catch (error) {
    console.error("Error fetching report data for share:", error);
    return NextResponse.json(
      { error: "Failed to load report data" },
      { status: 500 }
    );
  }
}
