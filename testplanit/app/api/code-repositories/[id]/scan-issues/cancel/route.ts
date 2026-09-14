import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { JOB_SCAN_REPO_ISSUES } from "~/lib/queueNames";
import { getRepoCacheQueue } from "~/lib/queues";
import { issueScanCancelKey } from "~/lib/services/impact/jobKeys";
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
    const user = await baseDb.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });
    if (!user?.access || !["ADMIN", "PROJECTADMIN"].includes(user.access)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
        select: { id: true, purpose: true, issueScanReport: true },
      }
    );
    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 }
      );
    }
    const running =
      !!config.issueScanReport &&
      typeof config.issueScanReport === "object" &&
      (config.issueScanReport as { running?: unknown }).running === true;
    const full =
      !!config.issueScanReport &&
      typeof config.issueScanReport === "object" &&
      (config.issueScanReport as { full?: unknown }).full === true;
    const cancelledReport = {
      cancelled: true,
      full,
      scannedAt: new Date().toISOString(),
    };

    const queue = getRepoCacheQueue();
    const tenantId = getCurrentTenantId();
    const jobs = queue
      ? await queue.getJobs(["active", "waiting", "delayed"])
      : [];
    const job = jobs.find(
      (j) =>
        j.name === JOB_SCAN_REPO_ISSUES &&
        Number(j.data?.configId) === configId &&
        j.data?.tenantId === tenantId
    );

    if (!job) {
      if (running) {
        await (baseDb as any).projectCodeRepositoryConfig.update({
          where: { id: configId },
          data: { issueScanReport: cancelledReport },
        });
      }
      return NextResponse.json({ cancelled: true, wasRunning: running });
    }

    const state = await job.getState();
    if (state === "waiting" || state === "delayed") {
      await job.remove();
      await (baseDb as any).projectCodeRepositoryConfig.update({
        where: { id: configId },
        data: { issueScanReport: cancelledReport },
      });
      return NextResponse.json({ cancelled: true, wasRunning: false });
    }

    // Active: the worker stops at its next check and writes the report.
    const connection = await queue!.client;
    await connection.set(issueScanCancelKey(configId), "1", { EX: 3600 });
    return NextResponse.json({ cancelling: true, jobId: job.id });
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
