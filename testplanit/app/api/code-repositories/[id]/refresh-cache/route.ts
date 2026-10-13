import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { getRepoCacheQueue } from "~/lib/queues";
import { enqueueRepoJob } from "~/lib/services/impact/repoJobs";
import { authOptions } from "~/server/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  // This endpoint kicks off a code-repository cache refresh (file listings +
  // contents). Admin/project-admin surface, cache hygiene with no business
  // object mutation. The actual fetch runs in the repo-cache worker so a
  // rate-limited provider can't time out (or HTML-error) the HTTP request —
  // the UI polls the config's cacheStatus for completion.
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

    // params.id is the repository id (for URL consistency), but we operate on the config
    await params; // consume params to avoid Next.js warning

    const body = await req.json();
    const { projectConfigId } = body;

    if (!projectConfigId) {
      return NextResponse.json(
        { error: "projectConfigId is required" },
        { status: 400 }
      );
    }

    const configId = parseInt(projectConfigId);

    const config = await (baseDb as any).projectCodeRepositoryConfig.findUnique(
      {
        where: { id: configId },
        select: { id: true, cacheEnabled: true },
      }
    );

    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 }
      );
    }

    if (!config.cacheEnabled) {
      return NextResponse.json(
        { error: "File caching is disabled for this project" },
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

    // One refresh per config+tenant at a time: a click while one is queued
    // or running joins it. `pending` marks the request; the queue-backed
    // status resolver reports it as queued until the worker picks it up.
    const { jobId } = await enqueueRepoJob(queue, {
      kind: "refresh-cache",
      configId,
      tenantId,
      beforeAdd: async () => {
        await (baseDb as any).projectCodeRepositoryConfig.update({
          where: { id: configId },
          data: { cacheStatus: "pending", cacheError: null },
        });
      },
    });

    return NextResponse.json({ queued: true, jobId });
  } catch (err: unknown) {
    console.error("[POST refresh-cache]:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
