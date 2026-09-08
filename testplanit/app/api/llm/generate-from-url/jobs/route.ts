import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getGenerateFromUrlQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

/**
 * GET: List recent generate-from-url jobs for the current user + project.
 * Query params: projectId (required), limit (optional, default 10)
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? 10),
    20
  );

  try {
    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json({ jobs: [] });
    }

    // Fetch recent jobs in all states
    const [active, waiting, completed, failed] = await Promise.all([
      queue.getJobs(["active"], 0, 10),
      queue.getJobs(["waiting"], 0, 10),
      queue.getJobs(["completed"], 0, 50),
      queue.getJobs(["failed"], 0, 20),
    ]);

    const currentTenantId = isMultiTenantMode()
      ? getCurrentTenantId()
      : undefined;
    const projectIdNum = Number(projectId);

    // Filter to current user + project + tenant, then sort by timestamp descending
    const allJobs = [...active, ...waiting, ...completed, ...failed]
      .filter((job) => {
        if (!job?.data) return false;
        if (job.data.userId !== session.user!.id) return false;
        if (job.data.projectId !== projectIdNum) return false;
        if (currentTenantId && job.data.tenantId !== currentTenantId)
          return false;
        return true;
      })
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, limit);

    // Check which jobs have generated results in Redis
    const connection = await queue.client;
    const jobs = await Promise.all(
      allJobs.map(async (job) => {
        const state = await job.getState();
        let hasGeneratedResults = false;
        let testCaseCount = 0;
        if (state === "completed") {
          const raw = await connection.get(
            `generate-from-url:generated:${job.id}`
          );
          if (raw) {
            hasGeneratedResults = true;
            try {
              const parsed = JSON.parse(raw);
              testCaseCount = parsed.testCases?.length ?? 0;
            } catch {
              // Ignore parse errors
            }
          }
        }
        const hasPageContent =
          state === "completed" && !hasGeneratedResults
            ? (await connection.get(`generate-from-url:pages:${job.id}`)) !==
              null
            : false;

        let result = null;
        if (state === "completed" && job.returnvalue != null) {
          const rv =
            typeof job.returnvalue === "string"
              ? JSON.parse(job.returnvalue)
              : job.returnvalue;
          result = {
            pagesProcessed: rv.pagesProcessed,
            crawlOnly: rv.crawlOnly,
          };
        }

        // Include progress for active/waiting jobs
        const progress =
          state === "active" || state === "waiting" ? job.progress : null;

        return {
          jobId: job.id,
          state,
          url: job.data.url,
          pagesProcessed: result?.pagesProcessed ?? 0,
          testCaseCount,
          hasGeneratedResults,
          hasPageContent,
          progress,
          timestamp: job.timestamp,
          finishedOn: job.finishedOn,
          failedReason: state === "failed" ? job.failedReason : null,
        };
      })
    );

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Generate from URL jobs list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
