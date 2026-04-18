import { NextRequest, NextResponse } from "next/server";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export async function POST(_request: NextRequest) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Bulk update: only credential-based users who are active and not already flagged
  // Per D-09: authMethod IN [INTERNAL, BOTH], exclude SSO-only
  // Exclude users who already have mustChangePassword: true
  const result = await db.user.updateMany({
    where: {
      authMethod: { in: ["INTERNAL", "BOTH"] },
      mustChangePassword: false,
      isDeleted: false,
      isActive: true,
    },
    data: { mustChangePassword: true },
  });

  // Single bulk audit event with count (per D-14, ENFORCE-06)
  captureAuditEvent({
    action: "FORCE_PASSWORD_CHANGE",
    entityType: "User",
    entityId: "bulk",
    userId: session.user.id,
    metadata: {
      triggeredBy: session.user.id,
      scope: "bulk",
      count: result.count,
    },
  }).catch(console.error);

  return NextResponse.json({ success: true, count: result.count });
}
