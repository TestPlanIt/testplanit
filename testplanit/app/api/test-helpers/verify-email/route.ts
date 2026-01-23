import { NextRequest, NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";

/**
 * Test helper endpoint to verify user emails.
 * This endpoint is only available in test/development environments.
 * It bypasses normal authentication to allow E2E tests to create verified users.
 */

export async function POST(req: NextRequest) {
  // Only allow when explicitly running E2E tests
  // Never available in actual production deployments
  const isE2ETest = process.env.E2E_PROD === "on" || process.env.NODE_ENV === "test";

  if (!isE2ETest) {
    return NextResponse.json(
      { error: "Test helper endpoints are only available during E2E tests" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Update user to set emailVerified
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("[Test Helper] Error verifying email:", error);
    return NextResponse.json(
      { error: "Failed to verify email" },
      { status: 500 }
    );
  }
}
