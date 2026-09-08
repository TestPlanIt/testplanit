import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "~/lib/auth-security";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { auditAuthEvent } from "~/lib/services/auditLog";
import { decryptSecret, verifyBackupCode, verifyTOTP } from "~/lib/two-factor";
import { authOptions } from "~/server/auth";

/**
 * POST /api/auth/two-factor/verify-sso
 * Verify 2FA token for SSO users after sign-in
 */
export const POST = withAuditContext(async (request: NextRequest) => {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        {
          errorCode: "auth.errors.verificationCodeRequired",
          error: "Verification code is required",
        },
        { status: 400 }
      );
    }

    // Rate limit by user ID
    if (
      !(await checkRateLimit(`2fa-verify-sso:${session.user.id}`, {
        windowMs: 60000,
        maxAttempts: 5,
      }))
    ) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    const user = await baseDb.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
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

    let verified = false;
    let usedBackupCode = false;
    let hashedCodes: string[] = [];

    // Try TOTP verification first
    const secret = decryptSecret(user.twoFactorSecret);
    verified = await verifyTOTP(token, secret);

    // Try backup code if TOTP failed
    if (!verified && user.twoFactorBackupCodes) {
      hashedCodes = JSON.parse(user.twoFactorBackupCodes) as string[];
      const codeIndex = verifyBackupCode(token, hashedCodes);

      if (codeIndex !== -1) {
        verified = true;
        usedBackupCode = true;

        // Remove the used backup code
        hashedCodes.splice(codeIndex, 1);
        await baseDb.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: JSON.stringify(hashedCodes) },
        });
      }
    }

    if (!verified) {
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 400 }
      );
    }

    // Audit successful 2FA verification during SSO flow. The verification
    // code itself is NOT logged — only the verification method (totp or
    // recovery-code).
    await auditAuthEvent(
      "TWO_FACTOR_VERIFIED",
      session.user.id,
      session.user.email ?? "",
      { provider: "sso", method: usedBackupCode ? "recovery-code" : "totp" },
      session.user.name
    );

    return NextResponse.json({
      success: true,
      usedBackupCode,
      remainingBackupCodes: usedBackupCode ? hashedCodes.length : undefined,
    });
  } catch (error) {
    console.error("2FA verify-sso error:", error);
    return NextResponse.json(
      { error: "Failed to verify 2FA" },
      { status: 500 }
    );
  }
});
