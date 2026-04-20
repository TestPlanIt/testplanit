import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { auditDataExport } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";

/**
 * POST /api/audit/export
 *
 * Log a data export event for audit tracking.
 * Called by client-side export functions after successful export.
 */
export const POST = withAuditContext(async (request: NextRequest) => {
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

    // Phase 64 Plan 02: NextAuth session callback (Plan 01 Task 3) already
    // enriched ALS with userId/userEmail/userName; withAuditContext seeded
    // ipAddress/userAgent/requestId. No manual auditContext construction
    // needed here — the audit helper reads ALS directly.
    await auditDataExport(exportType, entityType, {
      recordCount,
      filters,
      projectId,
      exportedBy: session.user.email,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[AuditExport] Error logging export:", error);
    return NextResponse.json(
      { error: "Failed to log export" },
      { status: 500 }
    );
  }
});
