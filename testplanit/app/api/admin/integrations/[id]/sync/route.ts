import { syncService } from "@/lib/integrations/services/SyncService";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { auditSystemConfigChange } from "~/lib/services/auditLog";
import { authOptions } from "~/server/auth";

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
      return NextResponse.json(
        { error: "Invalid integration ID" },
        { status: 400 }
      );
    }

    // SIMPLE_URL integrations have no API to pull from — sync is not supported
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { provider: true },
    });
    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }
    if (integration.provider === "SIMPLE_URL") {
      return NextResponse.json(
        { error: "Sync is not supported for Simple URL integrations" },
        { status: 400 }
      );
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

    // Audit the admin-triggered integration sync.
    auditSystemConfigChange(
      `integration.sync.${integrationId}`,
      null,
      {
        integrationId,
        jobId,
        triggeredBy: session.user.id ?? "unknown",
      }
    ).catch((error) => {
      console.error("Failed to audit integration sync trigger:", error);
    });

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
