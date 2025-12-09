import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";

/**
 * GET /api/auth/two-factor/settings
 * Get the system 2FA settings to determine if 2FA can be disabled
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const registrationSettings = await prisma.registrationSettings.findFirst({
      select: {
        force2FAAllLogins: true,
        force2FANonSSO: true,
      },
    });

    return NextResponse.json({
      force2FAAllLogins: registrationSettings?.force2FAAllLogins ?? false,
      force2FANonSSO: registrationSettings?.force2FANonSSO ?? false,
    });
  } catch (error) {
    console.error("2FA settings error:", error);
    return NextResponse.json(
      { error: "Failed to get 2FA settings" },
      { status: 500 }
    );
  }
}
