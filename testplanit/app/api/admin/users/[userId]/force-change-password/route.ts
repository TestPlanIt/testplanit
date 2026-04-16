import { NextRequest, NextResponse } from "next/server";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { invalidateSessionUserCache } from "~/lib/session-cache";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await context.params;

  // Verify user exists and is a credential user
  const targetUser = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, authMethod: true, email: true, isDeleted: true },
  });

  if (!targetUser || targetUser.isDeleted) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (targetUser.authMethod !== "INTERNAL" && targetUser.authMethod !== "BOTH") {
    return NextResponse.json(
      { error: "User does not have a password-based login" },
      { status: 400 }
    );
  }

  await db.user.update({
    where: { id: userId },
    data: { mustChangePassword: true },
  });

  // Invalidate session cache so user picks up the flag on next request
  await invalidateSessionUserCache(userId);

  // Audit event (per D-14, ENFORCE-06)
  captureAuditEvent({
    action: "FORCE_PASSWORD_CHANGE",
    entityType: "User",
    entityId: userId,
    entityName: targetUser.email ?? undefined,
    userId: session.user.id,
    metadata: { triggeredBy: session.user.id, scope: "individual" },
  }).catch(console.error);

  return NextResponse.json({ success: true });
}
