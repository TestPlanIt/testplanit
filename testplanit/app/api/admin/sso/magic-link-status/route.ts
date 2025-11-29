import { NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";

export async function GET() {
  const session = await getServerAuthSession();

  // Only allow admins to check configuration status
  if (!session?.user || session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if all required email environment variables are configured
  const isConfigured =
    !!process.env.EMAIL_SERVER_HOST &&
    !!process.env.EMAIL_SERVER_PORT &&
    !!process.env.EMAIL_SERVER_USER &&
    !!process.env.EMAIL_SERVER_PASSWORD &&
    !!process.env.EMAIL_FROM;

  return NextResponse.json({ configured: isConfigured });
}
