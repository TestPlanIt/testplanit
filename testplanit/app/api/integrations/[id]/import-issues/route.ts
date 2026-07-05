import {
  IMPORT_DEFAULT_CAP,
  IMPORT_MAX_CAP,
  syncService,
} from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authorizeProjectImport } from "~/lib/integrations/importAuthorization";
import { authOptions } from "~/server/auth";

/** Coerce the recency window to a positive whole number of days, or undefined. */
function normalizeDays(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), 3650);
}

/** Coerce the requested cap, defaulting and clamping to the server ceiling. */
function normalizeCap(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return IMPORT_DEFAULT_CAP;
  return Math.min(Math.floor(n), IMPORT_MAX_CAP);
}

/**
 * Trigger a background bulk import of issues from a single linked external
 * project into its TestPlanIt project, scoped by a recency window + cap.
 * Project-admin gated; the actual work runs on the `issue-sync` queue.
 */
export const POST = withAuditContext(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { id } = await params;
      const integrationId = parseInt(id);
      if (isNaN(integrationId)) {
        return NextResponse.json(
          { error: "Invalid integration ID" },
          { status: 400 }
        );
      }

      const body = await req.json().catch(() => ({}));
      const integrationProjectId = body?.integrationProjectId;
      if (!integrationProjectId || typeof integrationProjectId !== "string") {
        return NextResponse.json(
          { error: "integrationProjectId is required" },
          { status: 400 }
        );
      }

      const auth = await authorizeProjectImport(
        session,
        integrationId,
        integrationProjectId
      );
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        );
      }

      const updatedWithinDays = normalizeDays(body?.updatedWithinDays);
      const cap = normalizeCap(body?.cap);

      const jobId = await syncService.queueProjectImport(
        session.user.id,
        integrationId,
        integrationProjectId,
        { updatedWithinDays, cap }
      );

      if (!jobId) {
        return NextResponse.json(
          { error: "Failed to queue import job" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        jobId,
        cap,
        message:
          "Import job queued. Issues will be imported in the background.",
      });
    } catch (error: any) {
      console.error("Error queuing issue import:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
