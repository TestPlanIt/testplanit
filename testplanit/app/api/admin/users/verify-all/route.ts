import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";

/**
 * POST /api/admin/users/verify-all
 *
 * Verifies all users by setting their emailVerified timestamp to now.
 * This is used when disabling email verification to ensure all existing
 * users can continue to access the system.
 *
 * Security: Only accessible to ADMIN users
 */
export async function POST() {
  try {
    // Check authentication and authorization
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (session.user.access !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden - Admin access required" },
        { status: 403 }
      );
    }

    // Update all users without emailVerified to set it to now
    // Exclude SSO users as they don't need email verification
    const result = await prisma.user.updateMany({
      where: {
        emailVerified: null,
        authMethod: {
          in: ["INTERNAL", "BOTH"],
        },
      },
      data: {
        emailVerified: new Date(),
        emailVerifToken: null, // Clear verification token since they're now verified
      },
    });

    return NextResponse.json({
      success: true,
      verifiedCount: result.count,
      message: `Successfully verified ${result.count} user account(s)`,
    });
  } catch (error) {
    console.error("[Verify All Users API] Error:", error);
    return NextResponse.json(
      { error: "Failed to verify users" },
      { status: 500 }
    );
  }
}
