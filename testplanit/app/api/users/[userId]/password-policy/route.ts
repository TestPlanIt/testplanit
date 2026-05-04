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

  const [settings, user] = await Promise.all([
    db.registrationSettings.findFirst({
      select: {
        minPasswordLength: true,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requiredSpecialChars: true,
      },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { password: true },
    }),
  ]);

  // A "real" password is one the user chose — bcrypt hashes start with $2b$/$2a$.
  // SSO-auto-provisioned users get randomUUID() stored as plain text (no prefix).
  const hasPassword =
    typeof user?.password === "string" &&
    (user.password.startsWith("$2b$") || user.password.startsWith("$2a$"));

  if (!settings) {
    return NextResponse.json({ policy: null, hasPassword });
  }

  return NextResponse.json({ policy: settings, hasPassword });
}
