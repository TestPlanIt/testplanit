import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { syncService } from "@/lib/integrations/services/SyncService";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    if (session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: integrationIdParam } = await params;
    const integrationId = parseInt(integrationIdParam);

    if (isNaN(integrationId)) {
      return NextResponse.json({ error: "Invalid integration ID" }, { status: 400 });
    }

    // Queue the sync job for background processing
    const jobId = await syncService.queueSync(
      session.user.id,
      integrationId,
      { forceRefresh: true } // Force refresh to get latest data
    );

    if (!jobId) {
      return NextResponse.json(
        { error: "Failed to queue sync job" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      jobId,
      message: `Sync job queued for integration ${integrationId}. Issues will be updated in the background.`,
    });
  } catch (error: any) {
    console.error("Error syncing integration:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
