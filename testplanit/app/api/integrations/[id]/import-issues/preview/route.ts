import { getEnhancedDb } from "@/lib/auth/utils";
import { syncService } from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authorizeProjectImport } from "~/lib/integrations/importAuthorization";
import { authOptions } from "~/server/auth";

/** Coerce the recency window to a positive whole number of days, or undefined. */
function normalizeDays(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), 3650);
}

/**
 * Approximate how many issues a bulk import would pull, before writing
 * anything. Project-admin gated. Runs a live (page-of-1) tracker search so the
 * confirmation step can show "~N issues match" and whether the cap will bite.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const updatedWithinDays = normalizeDays(body?.updatedWithinDays);

    // Enhanced (policy) client so the adapter resolves the acting user's own
    // integration auth token for the live search.
    const db = await getEnhancedDb(session);
    const preview = await syncService.previewProjectImport(
      integrationId,
      integrationProjectId,
      { updatedWithinDays },
      { prismaClient: db }
    );

    return NextResponse.json(preview);
  } catch (error: any) {
    console.error("Error previewing issue import:", error);
    return NextResponse.json(
      { error: error.message || "Failed to preview import" },
      { status: 500 }
    );
  }
}
