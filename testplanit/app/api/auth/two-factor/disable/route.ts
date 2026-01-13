import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { verifyTOTP, decryptSecret, verifyBackupCode } from "~/lib/two-factor";

/**
 * POST /api/auth/two-factor/disable
 * Disable 2FA for the user (requires current 2FA token or backup code)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if system settings require 2FA
    const registrationSettings = await prisma.registrationSettings.findFirst();
    if (registrationSettings?.force2FAAllLogins || registrationSettings?.force2FANonSSO) {
      return NextResponse.json(
        { error: "Two-factor authentication is required by your organization and cannot be disabled" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { token, backupCode } = body;

    if (!token && !backupCode) {
      return NextResponse.json(
        { error: "Token or backup code is required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.twoFactorEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is not enabled" },
        { status: 400 }
      );
    }

    let verified = false;

    // Try TOTP verification first
    if (token && user.twoFactorSecret) {
      const secret = decryptSecret(user.twoFactorSecret);
      verified = await verifyTOTP(token, secret);
    }

    // Try backup code if TOTP failed or wasn't provided
    if (!verified && backupCode && user.twoFactorBackupCodes) {
      const hashedCodes = JSON.parse(user.twoFactorBackupCodes) as string[];
      const codeIndex = verifyBackupCode(backupCode, hashedCodes);
      verified = codeIndex !== -1;
    }

    if (!verified) {
      return NextResponse.json(
        { error: "Invalid verification code or backup code" },
        { status: 400 }
      );
    }

    // Disable 2FA and clear all related data
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("2FA disable error:", error);
    return NextResponse.json(
      { error: "Failed to disable 2FA" },
      { status: 500 }
    );
  }
}
