import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        isDeleted: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          isProjectMember: false,
          isActive: false,
          isDeleted: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      isProjectMember: true, // We'll determine this client-side based on context
      isActive: user.isActive,
      isDeleted: user.isDeleted,
    });
  } catch (error) {
    console.error("Error fetching user mention info:", error);
    return NextResponse.json(
      { error: "Failed to fetch user info" },
      { status: 500 }
    );
  }
}
