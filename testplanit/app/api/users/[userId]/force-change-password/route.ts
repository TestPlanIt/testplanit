import bcrypt from "bcrypt";
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { validatePasswordPolicy } from "~/lib/validate-password-policy";
import { updatePasswordHistory } from "~/lib/password-history";
import { invalidateSessionUserCache } from "~/lib/session-cache";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const routeParams = await context.params;
  const userId = routeParams.userId;

  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only the user themselves can use this endpoint
  if (session.user.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify mustChangePassword is true in JWT — prevent abuse of the no-current-password flow
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  if (!token?.mustChangePassword) {
    return NextResponse.json(
      { error: "Password change not required" },
      { status: 403 }
    );
  }

  const { newPassword } = await request.json();

  if (!newPassword) {
    return NextResponse.json(
      { error: "New password is required" },
      { status: 400 }
    );
  }

  // Validate against password policy (per D-01)
  const violations = await validatePasswordPolicy(userId, newPassword);
  if (violations.length > 0) {
    return NextResponse.json(
      { errors: violations.map((v) => v.message) },
      { status: 400 }
    );
  }

  try {
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    const settings = await db.registrationSettings.findFirst({
      select: { passwordHistoryDepth: true },
    });

    await db.user.update({
      where: { id: userId },
      data: {
        password: hashedNewPassword,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    // Store in password history (per D-03)
    if (settings && settings.passwordHistoryDepth > 0) {
      await updatePasswordHistory(userId, hashedNewPassword, settings.passwordHistoryDepth);
    }

    await invalidateSessionUserCache(userId);

    // Audit the forced password change
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    captureAuditEvent({
      action: "FORCE_PASSWORD_CHANGE",
      entityType: "User",
      entityId: userId,
      entityName: user?.email || session.user.email || "",
      userId,
      userEmail: user?.email || session.user.email || "",
      metadata: { forced: true },
    }).catch((error) =>
      console.error("[AuditLog] Failed to audit forced password change:", error)
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error in force-change-password:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
