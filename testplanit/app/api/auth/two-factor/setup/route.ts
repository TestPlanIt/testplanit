import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import {
  generateTOTPSecret,
  generateQRCodeDataURL,
  encryptSecret,
} from "~/lib/two-factor";

/**
 * GET /api/auth/two-factor/setup
 * Generate a new TOTP secret and QR code for 2FA setup
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
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
      where: { id: session.user.id },
      data: { twoFactorSecret: encryptedSecret },
    });

    return NextResponse.json({
      secret, // User can manually enter this in their authenticator app
      qrCode, // Data URL for QR code image
    });
  } catch (error) {
    console.error("2FA setup error:", error);
    return NextResponse.json(
      { error: "Failed to generate 2FA setup" },
      { status: 500 }
    );
  }
}
