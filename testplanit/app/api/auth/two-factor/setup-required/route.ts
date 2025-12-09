import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "~/lib/prisma";
import {
  generateTOTPSecret,
  generateQRCodeDataURL,
  encryptSecret,
} from "~/lib/two-factor";

const JWT_SECRET = process.env.NEXTAUTH_SECRET || "";

/**
 * POST /api/auth/two-factor/setup-required
 * Generate a new TOTP secret for forced 2FA setup during sign-in
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { setupToken } = body;

    if (!setupToken) {
      return NextResponse.json(
        { error: "Setup token is required" },
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
      select: { email: true, twoFactorEnabled: true },
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

    // Generate new secret
    const secret = generateTOTPSecret();
    const qrCode = await generateQRCodeDataURL(secret, user.email);

    // Store the secret temporarily (encrypted) - not enabled yet
    const encryptedSecret = encryptSecret(secret);
    await prisma.user.update({
      where: { id: tokenData.userId },
      data: { twoFactorSecret: encryptedSecret },
    });

    return NextResponse.json({
      secret,
      qrCode,
    });
  } catch (error) {
    console.error("2FA setup-required error:", error);
    return NextResponse.json(
      { error: "Failed to generate 2FA setup" },
      { status: 500 }
    );
  }
}
