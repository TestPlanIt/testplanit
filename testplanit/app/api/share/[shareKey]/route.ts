import { AuditAction } from "~/zenstack/models";
import bcrypt from "bcrypt";
import { getServerSession, type Session } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { frozenReportMeta } from "~/lib/reports/frozenReportMeta";
import { verifyShareAccessToken } from "~/lib/shareAccessToken";
import { NotificationService } from "~/lib/services/notificationService";
import { authOptions } from "~/server/auth";

export const dynamic = "force-dynamic";

/** Frozen-report metadata only; the stored payload is served by ./report. */
const SNAPSHOT_META_SELECT = {
  select: {
    capturedAt: true,
    rowCount: true,
    totalRowCount: true,
    truncated: true,
    capturedBy: { select: { name: true } },
  },
} as const;

/**
 * The project a share belongs to. A saved report keeps its project inside
 * its config (the row has none, which keeps it private).
 */
async function resolveProjectName(shareLink: {
  entityType: string;
  entityConfig: unknown;
  project: { name: string } | null;
}): Promise<string | null> {
  if (shareLink.project) return shareLink.project.name;
  if (shareLink.entityType !== "SAVED_REPORT") return null;
  const projectId = (shareLink.entityConfig as { projectId?: unknown } | null)
    ?.projectId;
  if (typeof projectId !== "number" || !Number.isInteger(projectId)) {
    return null;
  }
  const project = await baseDb.projects.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  return project?.name ?? null;
}

/** A saved report is private: only the user who saved it can open it. */
function canOpenSavedReport(
  shareLink: { entityType: string; createdById: string },
  session: Session | null
): boolean {
  return (
    shareLink.entityType !== "SAVED_REPORT" ||
    shareLink.createdById === session?.user?.id
  );
}

/**
 * GET /api/share/[shareKey]
 * Fetch share link metadata (without accessing content)
 * No authentication required
 */
export const GET = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ shareKey: string }> }
  ) => {
    try {
      const { shareKey } = await params;
      const session = await getServerSession(authOptions);

      // Fetch share link with project info (no auth required)
      const shareLink = await baseDb.shareLink.findUnique({
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
          snapshot: SNAPSHOT_META_SELECT,
        },
        // passwordHash is @omit; opt back in to verify PASSWORD_PROTECTED access.
        omit: { passwordHash: false },
      });

      if (!shareLink || !canOpenSavedReport(shareLink, session)) {
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
        projectName: await resolveProjectName(shareLink),
        createdBy: shareLink.createdBy.name,
        viewCount: shareLink.viewCount,
        requiresPassword: shareLink.mode === "PASSWORD_PROTECTED",
        frozen: shareLink.snapshot
          ? frozenReportMeta(shareLink.snapshot)
          : null,
      });
    } catch (error) {
      console.error("Error fetching share link:", error);
      return NextResponse.json(
        { error: "Failed to fetch share link" },
        { status: 500 }
      );
    }
  }
);

/**
 * POST /api/share/[shareKey]
 * Access shared content (with password verification if needed)
 * Logs access and triggers notifications
 */
export const POST = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ shareKey: string }> }
  ) => {
    try {
      const { shareKey } = await params;
      const session = await getServerSession(authOptions);
      const body = await req.json();
      const { password, token } = body;
      // A reload of a share already opened in this browser session re-checks
      // access without counting another view.
      const recordView = body.recordView !== false;

      // Fetch share link with full details
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
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          snapshot: SNAPSHOT_META_SELECT,
        },
        // passwordHash is @omit; opt back in to verify PASSWORD_PROTECTED access.
        omit: { passwordHash: false },
      });

      if (!shareLink || !canOpenSavedReport(shareLink, session)) {
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
        // Issued by password-verify once the password was entered.
        const hasValidToken = verifyShareAccessToken(
          token,
          shareKey,
          shareLink.passwordHash
        );
        // Check if user has project access (bypass password)
        if (session) {
          const hasProjectAccess =
            session.user.access === "ADMIN" ||
            !shareLink.project || // Cross-project reports accessible to all authenticated users
            shareLink.project.createdBy === session.user.id ||
            shareLink.project.userPermissions.length > 0;

          if (!hasProjectAccess && !hasValidToken) {
            // User is logged in but doesn't have project access, require password
            if (!password || !shareLink.passwordHash) {
              return NextResponse.json(
                { error: "Password required", requiresPassword: true },
                { status: 401 }
              );
            }

            // Verify password
            const isValid = await bcrypt.compare(
              password,
              shareLink.passwordHash
            );
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
          if (!hasValidToken) {
            if (!password || !shareLink.passwordHash) {
              return NextResponse.json(
                { error: "Password required", requiresPassword: true },
                { status: 401 }
              );
            }

            // Verify password
            const isValid = await bcrypt.compare(
              password,
              shareLink.passwordHash
            );
            if (!isValid) {
              return NextResponse.json(
                { error: "Invalid password" },
                { status: 401 }
              );
            }
          }
        }
      }

      if (recordView) {
        // Log access
        const ipAddress =
          req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
          req.headers.get("x-real-ip") ||
          null;
        const userAgent = req.headers.get("user-agent") || null;

        await baseDb.shareLinkAccessLog.create({
          data: {
            shareLinkId: shareLink.id,
            accessedById: session?.user?.id || null,
            ipAddress,
            userAgent,
            wasAuthenticated: !!session,
          },
        });

        // Increment view count and update last viewed
        await baseDb.shareLink.update({
          where: { id: shareLink.id },
          data: {
            viewCount: { increment: 1 },
            lastViewedAt: new Date(),
          },
        });

        // Create audit log
        await baseDb.auditLog.create({
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
                const reportType = config.reportType
                  ? config.reportType.replace(/-/g, " ")
                  : "report";
                notificationTitle = shareLink.project?.name
                  ? `${reportType} for ${shareLink.project.name}`
                  : reportType;
              } else {
                const entityType = shareLink.entityType
                  .toLowerCase()
                  .replace(/_/g, " ");
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
        projectName: await resolveProjectName(shareLink),
        viewCount: shareLink.viewCount + (recordView ? 1 : 0),
        accessed: true,
        frozen: shareLink.snapshot
          ? frozenReportMeta(shareLink.snapshot)
          : null,
      });
    } catch (error) {
      console.error("Error accessing share link:", error);
      return NextResponse.json(
        { error: "Failed to access share link" },
        { status: 500 }
      );
    }
  }
);
