import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { auditAuthEvent } from "~/lib/services/auditLog";
import {
  decryptSecret,
  generateBackupCodes,
  verifyTOTP,
} from "~/lib/two-factor";
import { authOptions } from "~/server/auth";

/**
 * POST /api/auth/two-factor/regenerate-codes
 * Regenerate backup codes (requires current 2FA token)
 */
export const POST = withAuditContext(async (request: NextRequest) => {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Current 2FA token is required" },
        { status: 400 }
      );
    }

    const user = await baseDb.user.findUnique({
      where: { id: session.user.id },
      select: {
        twoFactorEnabled: true,
        twoFactorSecret: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return NextResponse.json(
        { error: "Two-factor authentication is not enabled" },
        { status: 400 }
      );
    }

    // Verify the current token
    const secret = decryptSecret(user.twoFactorSecret);
    const isValid = await verifyTOTP(token, secret);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 400 }
      );
    }

    // Generate new backup codes
    const { plainCodes, hashedCodes } = generateBackupCodes(10);

    // Update stored backup codes
    await baseDb.user.update({
      where: { id: session.user.id },
      data: {
        twoFactorBackupCodes: JSON.stringify(hashedCodes),
      },
    });

    // Audit backup-code regeneration. The regenerated codes themselves
    // are NOT logged — only the count.
    await auditAuthEvent(
      "TWO_FACTOR_CODES_REGENERATED",
      session.user.id,
      session.user.email ?? "",
      { count: plainCodes.length },
      session.user.name
    );

    return NextResponse.json({
      success: true,
      backupCodes: plainCodes,
    });
  } catch (error) {
    console.error("2FA regenerate codes error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate backup codes" },
      { status: 500 }
    );
  }
});
