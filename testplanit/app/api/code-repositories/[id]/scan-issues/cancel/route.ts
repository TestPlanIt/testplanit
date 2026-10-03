import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { getRepoCacheQueue } from "~/lib/queues";
import { issueScanCancelKey } from "~/lib/services/impact/jobKeys";
import { findRepoJob, isLiveJobState } from "~/lib/services/impact/repoJobs";
import { setCancelFlags } from "~/lib/services/jobCancel";
import { authOptions } from "~/server/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  projectConfigId: z.coerce.number().int().positive(),
});

/**
 * POST /api/code-repositories/[id]/scan-issues/cancel
 * Stop a ticket scan. A job still waiting in the queue is removed and the
 * config's report says cancelled at once; a job the worker is running gets
 * a flag it polls between pages, import rounds and commits, and writes the
 * cancelled report itself when it stops. With no job at all, a leftover
 * running flag is simply cleared.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "projectConfigId is required" },
        { status: 400 }
      );
    }
    const configId = parsed.data.projectConfigId;

    const config = await (baseDb as any).projectCodeRepositoryConfig.findUnique(
      {
        where: { id: configId },
        select: {
          id: true,
          purpose: true,
          projectId: true,
          issueScanReport: true,
        },
      }
    );
    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 }
      );
    }
    // Project-admin gate on the config's own project — the same authority
    // the Impact settings page and the config's write policy key off.
    const auth = await authorizeProjectAdminForProject(
      session,
      config.projectId
    );
    if (!auth.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const report =
      config.issueScanReport && typeof config.issueScanReport === "object"
        ? (config.issueScanReport as {
            running?: unknown;
            queued?: unknown;
            full?: unknown;
          })
        : null;
    // The read above came through the queue-backed resolver, so a running
    // or queued flag here is one the queue vouched for (or was just
    // rewritten as interrupted, which is neither).
    const running = report?.running === true || report?.queued === true;
    const cancelledReport = {
      cancelled: true,
      full: report?.full === true,
      scannedAt: new Date().toISOString(),
    };

    const queue = getRepoCacheQueue();
    const tenantId = getCurrentTenantId();
    const found = queue
      ? await findRepoJob(queue, "scan-issues", configId, tenantId)
      : null;

    if (!found || !isLiveJobState(found.state)) {
      if (running) {
        await (baseDb as any).projectCodeRepositoryConfig.update({
          where: { id: configId },
          data: { issueScanReport: cancelledReport },
        });
      }
      return NextResponse.json({ cancelled: true, wasRunning: running });
    }

    if (found.state !== "active") {
      await found.job.remove();
      await (baseDb as any).projectCodeRepositoryConfig.update({
        where: { id: configId },
        data: { issueScanReport: cancelledReport },
      });
      return NextResponse.json({ cancelled: true, wasRunning: false });
    }

    // Active: the worker stops at its next check and writes the report.
    await setCancelFlags(await queue!.client, [issueScanCancelKey(configId)]);
    return NextResponse.json({ cancelling: true, jobId: found.job.id });
  } catch (err: unknown) {
    console.error("[POST scan-issues/cancel]:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
