import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { enhance } from "@zenstackhq/runtime";
import { prisma } from "~/lib/prisma";
import bcrypt from "bcrypt";
import { NotificationService } from "~/lib/services/notificationService";
import { AuditAction } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/share/[shareKey]
 * Fetch share link metadata (without accessing content)
 * No authentication required
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareKey: string }> }
) {
  try {
    const { shareKey } = await params;

    // Fetch share link with project info (no auth required)
    const shareLink = await prisma.shareLink.findUnique({
      where: { shareKey },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
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

    // Check if deleted
    if (shareLink.isDeleted) {
      return NextResponse.json(
        { error: "This share link has been deleted", deleted: true },
        { status: 404 }
      );
    }

    // Check if revoked
    if (shareLink.isRevoked) {
      return NextResponse.json(
        { error: "This share link has been revoked", revoked: true },
        { status: 403 }
      );
    }

    // Check if expired
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired", expired: true },
        { status: 403 }
      );
    }

    // Return metadata (without passwordHash)
    return NextResponse.json({
      id: shareLink.id,
      entityType: shareLink.entityType,
      entityId: shareLink.entityId,
      entityConfig: shareLink.entityConfig,
      mode: shareLink.mode,
      title: shareLink.title,
      description: shareLink.description,
      projectId: shareLink.projectId,
      projectName: shareLink.project?.name || null,
      createdBy: shareLink.createdBy.name,
      viewCount: shareLink.viewCount,
      requiresPassword: shareLink.mode === "PASSWORD_PROTECTED",
    });
  } catch (error) {
    console.error("Error fetching share link:", error);
    return NextResponse.json(
      { error: "Failed to fetch share link" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/share/[shareKey]
 * Access shared content (with password verification if needed)
 * Logs access and triggers notifications
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shareKey: string }> }
) {
  try {
    const { shareKey } = await params;
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { password, token } = body;

    // Fetch share link with full details
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
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
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

    // Check if deleted
    if (shareLink.isDeleted) {
      return NextResponse.json(
        { error: "This share link has been deleted" },
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

    // Handle AUTHENTICATED mode
    if (shareLink.mode === "AUTHENTICATED") {
      if (!session) {
        return NextResponse.json(
          { error: "Authentication required", requiresAuth: true },
          { status: 401 }
        );
      }

      // Check if user has project access (or if it's a cross-project report)
      const hasProjectAccess =
        session.user.access === "ADMIN" ||
        !shareLink.project || // Cross-project reports accessible to all authenticated users
        shareLink.project.createdBy === session.user.id ||
        shareLink.project.userPermissions.length > 0;

      if (!hasProjectAccess) {
        return NextResponse.json(
          { error: "You do not have access to this project" },
          { status: 403 }
        );
      }
    }

    // Handle PASSWORD_PROTECTED mode
    if (shareLink.mode === "PASSWORD_PROTECTED") {
      // Check if user has project access (bypass password)
      if (session) {
        const hasProjectAccess =
          session.user.access === "ADMIN" ||
          !shareLink.project || // Cross-project reports accessible to all authenticated users
          shareLink.project.createdBy === session.user.id ||
          shareLink.project.userPermissions.length > 0;

        if (!hasProjectAccess) {
          // User is logged in but doesn't have project access, require password
          if (!password || !shareLink.passwordHash) {
            return NextResponse.json(
              { error: "Password required", requiresPassword: true },
              { status: 401 }
            );
          }

          // Verify password
          const isValid = await bcrypt.compare(password, shareLink.passwordHash);
          if (!isValid) {
            return NextResponse.json(
              { error: "Invalid password" },
              { status: 401 }
            );
          }
        }
        // User has project access, bypass password
      } else {
        // Not logged in, require password or valid token
        // Token is provided after successful password verification
        const hasValidToken = token === shareKey;

        if (!hasValidToken) {
          if (!password || !shareLink.passwordHash) {
            return NextResponse.json(
              { error: "Password required", requiresPassword: true },
              { status: 401 }
            );
          }

          // Verify password
          const isValid = await bcrypt.compare(password, shareLink.passwordHash);
          if (!isValid) {
            return NextResponse.json(
              { error: "Invalid password" },
              { status: 401 }
            );
          }
        }
      }
    }

    // Log access
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const userAgent = req.headers.get("user-agent") || null;

    await prisma.shareLinkAccessLog.create({
      data: {
        shareLinkId: shareLink.id,
        accessedById: session?.user?.id || null,
        ipAddress,
        userAgent,
        wasAuthenticated: !!session,
      },
    });

    // Increment view count and update last viewed
    await prisma.shareLink.update({
      where: { id: shareLink.id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: session?.user?.id || null,
        userEmail: session?.user?.email || null,
        userName: session?.user?.name || "Anonymous",
        action: AuditAction.SHARE_LINK_ACCESSED,
        entityType: "ShareLink",
        entityId: shareLink.id,
        entityName: shareLink.title || `${shareLink.entityType} share`,
        metadata: {
          shareKey,
          entityType: shareLink.entityType,
          mode: shareLink.mode,
          ipAddress,
          userAgent,
        },
        projectId: shareLink.projectId,
      },
    });

    // Trigger notification if enabled
    if (shareLink.notifyOnView) {
      try {
        // Build a descriptive title for the notification
        let notificationTitle = shareLink.title;

        if (!notificationTitle) {
          // Generate title from entity type and project
          if (shareLink.entityType === "REPORT" && shareLink.entityConfig) {
            const config = shareLink.entityConfig as any;
            const reportType = config.reportType ? config.reportType.replace(/-/g, " ") : "report";
            notificationTitle = shareLink.project?.name
              ? `${reportType} for ${shareLink.project.name}`
              : reportType;
          } else {
            const entityType = shareLink.entityType.toLowerCase().replace(/_/g, " ");
            notificationTitle = shareLink.project?.name
              ? `${entityType} for ${shareLink.project.name}`
              : entityType;
          }
        }

        await NotificationService.createShareLinkAccessedNotification(
          shareLink.createdById,
          notificationTitle || "Shared content",
          session?.user?.name || null,
          session?.user?.email || null,
          shareLink.id,
          shareLink.projectId ?? undefined
        );
      } catch (error) {
        console.error("Failed to send share access notification:", error);
        // Don't fail the request if notification fails
      }
    }

    // Return share link data
    return NextResponse.json({
      id: shareLink.id,
      entityType: shareLink.entityType,
      entityId: shareLink.entityId,
      entityConfig: shareLink.entityConfig,
      mode: shareLink.mode,
      title: shareLink.title,
      description: shareLink.description,
      projectId: shareLink.projectId,
      projectName: shareLink.project?.name || null,
      viewCount: shareLink.viewCount + 1,
      accessed: true,
    });
  } catch (error) {
    console.error("Error accessing share link:", error);
    return NextResponse.json(
      { error: "Failed to access share link" },
      { status: 500 }
    );
  }
}
