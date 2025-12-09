import { NextRequest, NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import { verifyTOTP, decryptSecret, verifyBackupCode } from "~/lib/two-factor";
import { checkRateLimit } from "~/lib/auth-security";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.NEXTAUTH_SECRET || "";

/**
 * POST /api/auth/two-factor/verify
 * Verify 2FA token during sign-in flow
 * This endpoint is called after initial credentials verification
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, backupCode, pendingAuthToken } = body;

    if (!pendingAuthToken) {
      return NextResponse.json(
        { error: "Invalid authentication session" },
        { status: 400 }
      );
    }

    if (!token && !backupCode) {
      return NextResponse.json(
        { error: "Token or backup code is required" },
        { status: 400 }
      );
    }

    // Verify the pending auth token
    let pendingAuth: { userId: string; email: string };
    try {
      pendingAuth = jwt.verify(pendingAuthToken, JWT_SECRET) as {
        userId: string;
        email: string;
      };
    } catch {
      return NextResponse.json(
        { error: "Authentication session expired" },
        { status: 401 }
      );
    }

    // Rate limit by user ID
    if (!checkRateLimit(`2fa-verify:${pendingAuth.userId}`, { windowMs: 60000, maxAttempts: 5 })) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: pendingAuth.userId },
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

    // Try TOTP verification first
    if (token) {
      const secret = decryptSecret(user.twoFactorSecret);
      verified = verifyTOTP(token, secret);
    }

    // Try backup code if TOTP failed
    if (!verified && backupCode && user.twoFactorBackupCodes) {
      const hashedCodes = JSON.parse(user.twoFactorBackupCodes) as string[];
      const codeIndex = verifyBackupCode(backupCode, hashedCodes);

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

    // Generate a completion token that the sign-in page can use
    const completionToken = jwt.sign(
      {
        userId: user.id,
        twoFactorVerified: true,
        exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      },
      JWT_SECRET
    );

    return NextResponse.json({
      success: true,
      completionToken,
      usedBackupCode,
      remainingBackupCodes: usedBackupCode
        ? JSON.parse(user.twoFactorBackupCodes || "[]").length - 1
        : undefined,
    });
  } catch (error) {
    console.error("2FA verify error:", error);
    return NextResponse.json(
      { error: "Failed to verify 2FA" },
      { status: 500 }
    );
  }
}
