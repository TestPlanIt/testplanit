import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import {
  verifyTOTP,
  decryptSecret,
  generateBackupCodes,
} from "~/lib/two-factor";

/**
 * POST /api/auth/two-factor/regenerate-codes
 * Regenerate backup codes (requires current 2FA token)
 */
export async function POST(request: NextRequest) {
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

    const user = await prisma.user.findUnique({
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
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        twoFactorBackupCodes: JSON.stringify(hashedCodes),
      },
    });

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
}
