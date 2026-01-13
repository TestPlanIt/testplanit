import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "~/lib/prisma";
import {
  verifyTOTP,
  decryptSecret,
  generateBackupCodes,
} from "~/lib/two-factor";

const JWT_SECRET = process.env.NEXTAUTH_SECRET || "";

/**
 * POST /api/auth/two-factor/enable-required
 * Verify the TOTP token and enable 2FA during forced setup flow
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, setupToken } = body;

    if (!setupToken) {
      return NextResponse.json(
        { error: "Setup token is required" },
        { status: 400 }
      );
    }

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Verification code is required" },
        { status: 400 }
      );
    }

    // Verify the setup token
    let tokenData: { userId: string; email: string; twoFactorSetupRequired: boolean };
    try {
      tokenData = jwt.verify(setupToken, JWT_SECRET) as typeof tokenData;
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired setup token. Please sign in again." },
        { status: 401 }
      );
    }

    if (!tokenData.twoFactorSetupRequired) {
      return NextResponse.json(
        { error: "Invalid setup token" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: tokenData.userId },
      select: {
        twoFactorEnabled: true,
        twoFactorSecret: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled" },
        { status: 400 }
      );
    }

    if (!user.twoFactorSecret) {
      return NextResponse.json(
        { error: "Please start the 2FA setup process first" },
        { status: 400 }
      );
    }

    // Decrypt and verify the token
    const secret = decryptSecret(user.twoFactorSecret);
    const isValid = await verifyTOTP(token, secret);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 400 }
      );
    }

    // Generate backup codes
    const { plainCodes, hashedCodes } = generateBackupCodes(10);

    // Enable 2FA and store backup codes
    await prisma.user.update({
      where: { id: tokenData.userId },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: JSON.stringify(hashedCodes),
      },
    });

    return NextResponse.json({
      success: true,
      backupCodes: plainCodes,
    });
  } catch (error) {
    console.error("2FA enable-required error:", error);
    return NextResponse.json(
      { error: "Failed to enable 2FA" },
      { status: 500 }
    );
  }
}
