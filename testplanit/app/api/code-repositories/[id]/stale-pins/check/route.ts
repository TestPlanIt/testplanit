import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { getRepoCacheQueue } from "~/lib/queues";
import { enqueueRepoJob } from "~/lib/services/impact/repoJobs";
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
 * tip and the settings page polls the config's stalePinReport, which the
 * queue-backed status resolver reports as queued, running or interrupted
 * until the check finishes.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        select: { id: true, purpose: true, projectId: true },
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

    // One check per config at a time: a click while one is queued or running
    // joins it. The config records only that the check was asked for; the
    // worker writes `running` when it starts.
    const { jobId } = await enqueueRepoJob(queue, {
      kind: "stale-pins",
      configId,
      tenantId,
      beforeAdd: async () => {
        await (baseDb as any).projectCodeRepositoryConfig.update({
          where: { id: configId },
          data: {
            stalePinReport: {
              queued: true,
              requestedAt: new Date().toISOString(),
            },
          },
        });
      },
    });

    return NextResponse.json({ queued: true, jobId });
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
