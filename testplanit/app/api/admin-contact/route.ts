import { NextResponse } from "next/server";
import { db } from "~/server/db";

export async function GET() {
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
      email: admin?.email || null,
    });
  } catch (error) {
    console.error("Error fetching admin contact:", error);
    return NextResponse.json({ email: null });
  }
}
