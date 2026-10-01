import { NextResponse } from "next/server";
import { db } from "~/server/db";

/**
 * The sign-in page's "Trouble signing in?" line is on by default. Set
 * SIGNIN_ADMIN_CONTACT to "false" to remove it; this unauthenticated endpoint
 * then never looks up the admin's email.
 */
function isAdminContactEnabled(): boolean {
  return process.env.SIGNIN_ADMIN_CONTACT?.toLowerCase() !== "false";
}

export async function GET() {
  if (!isAdminContactEnabled()) {
    return NextResponse.json({ enabled: false, email: null });
  }

  try {
    // Find the first admin user
    const admin = await db.user.findFirst({
      where: {
        access: "ADMIN",
        isDeleted: false,
        isActive: true,
      },
      select: {
        email: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return NextResponse.json({
      enabled: true,
      email: admin?.email || null,
    });
  } catch (error) {
    console.error("Error fetching admin contact:", error);
    return NextResponse.json({ enabled: true, email: null });
  }
}
