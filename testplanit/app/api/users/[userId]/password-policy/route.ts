import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await context.params;

  // Only the user themselves can view their policy requirements
  if (session.user.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await db.registrationSettings.findFirst({
    select: {
      minPasswordLength: true,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requiredSpecialChars: true,
    },
  });

  if (!settings) {
    return NextResponse.json({ policy: null });
  }

  return NextResponse.json({ policy: settings });
}
