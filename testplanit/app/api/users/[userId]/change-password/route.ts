import bcrypt from "bcrypt";
import { NextRequest, NextResponse } from "next/server";
import { updatePasswordHistory } from "~/lib/password-history";
import { invalidateSessionUserCache } from "~/lib/session-cache";
import { auditPasswordChange } from "~/lib/services/auditLog";
import { validatePasswordPolicy } from "~/lib/validate-password-policy";
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

  if (session.user.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { currentPassword, newPassword } = await request.json();

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Current password and new password are required" },
      { status: 400 }
    );
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.password) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { error: "Invalid current password" },
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

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Fetch passwordHistoryDepth for history update
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
      await updatePasswordHistory(
        userId,
        hashedNewPassword,
        settings.passwordHistoryDepth
      );
    }

    // Invalidate cached session data so the session callback fetches fresh
    // passwordChangedAt from DB on next request.
    await invalidateSessionUserCache(userId);

    // Audit the password change
    auditPasswordChange(
      userId,
      user.email || session.user.email || "",
      false
    ).catch((error) =>
      console.error("[AuditLog] Failed to audit password change:", error)
    );

    return NextResponse.json(
      { message: "Password updated successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating password:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
