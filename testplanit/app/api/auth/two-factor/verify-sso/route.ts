import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { verifyTOTP, decryptSecret, verifyBackupCode } from "~/lib/two-factor";
import { checkRateLimit } from "~/lib/auth-security";

/**
 * POST /api/auth/two-factor/verify-sso
 * Verify 2FA token for SSO users after sign-in
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        { error: "Verification code is required" },
        { status: 400 }
      );
    }

    // Rate limit by user ID
    if (
      !checkRateLimit(`2fa-verify-sso:${session.user.id}`, {
        windowMs: 60000,
        maxAttempts: 5,
      })
    ) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
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
    verified = verifyTOTP(token, secret);

    // Try backup code if TOTP failed
    if (!verified && user.twoFactorBackupCodes) {
      hashedCodes = JSON.parse(user.twoFactorBackupCodes) as string[];
      const codeIndex = verifyBackupCode(token, hashedCodes);

      if (codeIndex !== -1) {
        verified = true;
        usedBackupCode = true;

        // Remove the used backup code
        hashedCodes.splice(codeIndex, 1);
        await prisma.user.update({
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
}
