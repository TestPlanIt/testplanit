import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { JOB_CHECK_STALE_PINS } from "~/lib/queueNames";
import { getRepoCacheQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  projectConfigId: z.coerce.number().int().positive(),
});

/**
 * POST /api/code-repositories/[id]/stale-pins/check
 * Queue a stale Code Pin check for one Impact connection. Mirrors
 * scan-issues: the repo-cache worker evaluates every pin against the branch
 * tip and the settings page polls the config's stalePinReport, which holds
 * `{ running: true, ... }` until the check finishes.
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

    const config = await (baseDb as any).projectCodeRepositoryConfig.findUnique(
      {
        where: { id: configId },
        select: { id: true, purpose: true },
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
        { error: "Stale pin checks run on Impact repositories only" },
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

    // One check per config at a time: a click while one runs joins it.
    const existingJobs = await queue.getJobs(["active", "waiting", "delayed"]);
    const existing = existingJobs.find(
      (j) =>
        j.name === JOB_CHECK_STALE_PINS &&
        Number(j.data?.configId) === configId &&
        j.data?.tenantId === tenantId
    );
    if (existing) {
      return NextResponse.json({ queued: true, jobId: existing.id });
    }

    // Mark it running now so the page shows progress before the worker starts.
    const startedAt = new Date().toISOString();
    await (baseDb as any).projectCodeRepositoryConfig.update({
      where: { id: configId },
      data: {
        stalePinReport: {
          running: true,
          startedAt,
          progressAt: startedAt,
          checkedFiles: 0,
          totalFiles: 0,
          pins: 0,
        },
      },
    });

    const job = await queue.add(JOB_CHECK_STALE_PINS, { configId, tenantId });

    return NextResponse.json({ queued: true, jobId: job.id });
  } catch (err: unknown) {
    console.error("[POST stale-pins/check]:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
