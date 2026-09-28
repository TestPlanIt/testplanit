import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getRepoCacheQueue } from "~/lib/queues";
import { enqueueRepoJob } from "~/lib/services/impact/repoJobs";
import { authOptions } from "~/server/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  projectConfigId: z.coerce.number().int().positive(),
  /** Walk the whole branch and backfill, instead of the recent window. */
  full: z.boolean().optional(),
});

/**
 * POST /api/code-repositories/[id]/scan-issues
 * Queue a ticket scan for one Impact config without refreshing its file
 * cache. Mirrors refresh-cache: the work runs in the repo-cache worker and the
 * settings page polls the config's issueScanReport, which the queue-backed
 * status resolver reports as queued, running or interrupted until the scan
 * finishes.
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

    // params.id is the repository id (for URL consistency); the config is the unit of work.
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
    const { projectConfigId: configId } = parsed.data;
    const full = parsed.data.full === true;

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
    if (config.purpose !== "IMPACT") {
      return NextResponse.json(
        { error: "Ticket scans run on Impact repositories only" },
        { status: 400 }
      );
    }

    const queue = getRepoCacheQueue();
    if (!queue) {
      return NextResponse.json(
        {
          error:
            "Background job queue is not available. Ensure the repo-cache worker is running.",
        },
        { status: 503 }
      );
    }

    const tenantId = getCurrentTenantId();

    // One scan per config at a time: a click while one is queued or running
    // joins it. The config records only that the scan was asked for; the
    // worker writes `running` when it starts.
    const { jobId } = await enqueueRepoJob(queue, {
      kind: "scan-issues",
      configId,
      tenantId,
      data: { full },
      beforeAdd: async () => {
        await (baseDb as any).projectCodeRepositoryConfig.update({
          where: { id: configId },
          data: {
            issueScanReport: {
              queued: true,
              full,
              requestedAt: new Date().toISOString(),
            },
          },
        });
      },
    });

    return NextResponse.json({ queued: true, jobId });
  } catch (err: unknown) {
    console.error("[POST scan-issues]:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
