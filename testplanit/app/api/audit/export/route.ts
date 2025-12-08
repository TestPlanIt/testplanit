import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { auditDataExport } from "~/lib/services/auditLog";
import {
  updateAuditContext,
  extractAuditContextFromRequest,
  runWithAuditContext,
} from "~/lib/auditContext";

/**
 * POST /api/audit/export
 *
 * Log a data export event for audit tracking.
 * Called by client-side export functions after successful export.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { exportType, entityType, recordCount, filters, projectId } = body;

    if (!exportType || !entityType) {
      return NextResponse.json(
        { error: "Missing required fields: exportType, entityType" },
        { status: 400 }
      );
    }

    // Set up audit context
    const auditContext = extractAuditContextFromRequest(request);
    auditContext.userId = session.user.id;
    auditContext.userEmail = session.user.email || undefined;
    auditContext.userName = session.user.name || undefined;

    await runWithAuditContext(auditContext, async () => {
      await auditDataExport(exportType, entityType, {
        recordCount,
        filters,
        projectId,
        exportedBy: session.user.email,
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[AuditExport] Error logging export:", error);
    return NextResponse.json(
      { error: "Failed to log export" },
      { status: 500 }
    );
  }
}
