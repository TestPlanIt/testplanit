import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { invalidateSessionUserCache } from "~/lib/session-cache";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export const POST = withAuditContext(
  async (
    _request: NextRequest,
    context: { params: Promise<{ userId: string }> }
  ) => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await context.params;

    // Verify user exists
    const targetUser = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isDeleted: true,
        authMethod: true,
        password: true,
      },
    });

    if (!targetUser || targetUser.isDeleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!targetUser.password) {
      return NextResponse.json(
        { error: "User does not have a password to revoke" },
        { status: 400 }
      );
    }

    // Pre-flight check: ensure a passwordless login method exists (per D-11)
    // Check for any enabled MAGIC_LINK SSO provider in DB
    const magicLinkProvider = await db.ssoProvider.findFirst({
      where: { type: "MAGIC_LINK", enabled: true },
    });

    // Check email server env vars (same pattern as getDynamicProviders in server/auth.ts)
    const emailServerConfigured =
      !!process.env.EMAIL_SERVER_HOST &&
      !!process.env.EMAIL_SERVER_PORT &&
      !!process.env.EMAIL_SERVER_USER &&
      !!process.env.EMAIL_SERVER_PASSWORD &&
      !!process.env.EMAIL_FROM;

    if (!magicLinkProvider && !emailServerConfigured) {
      return NextResponse.json(
        {
          error:
            "Cannot revoke password: no passwordless login method is configured. Enable Magic Link or configure an email server first.",
        },
        { status: 400 }
      );
    }

    // Revoke: set password to null, update passwordChangedAt to trigger session invalidation (Pitfall 6)
    await db.user.update({
      where: { id: userId },
      data: {
        password: null,
        passwordChangedAt: new Date(),
        mustChangePassword: false, // no point forcing change if password is null
      },
    });

    // Invalidate session cache immediately
    await invalidateSessionUserCache(userId);

    // Audit event (per D-15, ENFORCE-06)
    await captureAuditEvent({
      action: "PASSWORD_REVOKED",
      entityType: "User",
      entityId: userId,
      entityName: targetUser.email ?? undefined,
      userId: session.user.id,
      metadata: { revokedBy: session.user.id },
    });

    return NextResponse.json({ success: true });
  }
);
