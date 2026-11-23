import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getGenerateFromUrlQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { finishedJob } from "~/lib/finishedJob";

async function handleGET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }

    const { jobId } = await params;
    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Multi-tenant isolation: don't reveal job exists to other tenants
    if (isMultiTenantMode()) {
      const currentTenantId = getCurrentTenantId();
      if (!currentTenantId) {
        return NextResponse.json(
          { error: "Multi-tenant mode enabled but tenant ID not configured" },
          { status: 500 }
        );
      }
      if (job.data?.tenantId !== currentTenantId) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
    }

    const state = await job.getState();
    const current = await finishedJob(queue, job, state);

    // BullMQ may return returnvalue as a JSON string or parsed object
    // depending on how it was stored/retrieved. Ensure it's always an object.
    let result = null;
    if (state === "completed" && current.returnvalue != null) {
      result =
        typeof current.returnvalue === "string"
          ? JSON.parse(current.returnvalue)
          : current.returnvalue;
    }

    // For crawl-only jobs, check for saved generated test cases first,
    // then fall back to loading crawled page content from Redis.
    let generatedTestCases = null;
    if (state === "completed" && result?.crawlOnly) {
      try {
        const connection = await queue.getBackend().client;

        // Check for previously generated test cases (saved after SSE streaming)
        const savedResults = await connection.get(
          `generate-from-url:generated:${jobId}`
        );
        if (savedResults) {
          generatedTestCases = JSON.parse(savedResults);
        } else {
          // Fall back to crawled page content for fresh generation
          const raw = await connection.get(`generate-from-url:pages:${jobId}`);
          if (raw) {
            result.crawledPages = JSON.parse(raw);
          }
        }
      } catch {
        // Ignore — crawledPages without markdown is still usable
      }
    }

    return NextResponse.json({
      jobId: current.id,
      state,
      progress: current.progress,
      result,
      generatedTestCases,
      failedReason: state === "failed" ? current.failedReason : null,
      timestamp: current.timestamp,
      processedOn: current.processedOn,
      finishedOn: current.finishedOn,
    });
  } catch (error) {
    console.error("Generate from URL status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const GET = withRequestRouting(handleGET);

/**
 * PUT: Save generated test cases to Redis so the notification link
 * can restore them without re-running LLM generation.
 */
async function handlePUT(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Queue not available" },
        { status: 503 }
      );
    }

    const { jobId } = await params;
    const body = await request.json();

    const connection = await queue.getBackend().client;
    await connection.set(
      `generate-from-url:generated:${jobId}`,
      JSON.stringify(body),
      { EX: 604800 } // 7 day TTL
    );

    return NextResponse.json({ message: "Saved" });
  } catch (error) {
    console.error("Generate from URL save error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const PUT = withRequestRouting(handlePUT);

/**
 * DELETE: Clean up crawled page content and generated results from Redis after import.
 * Prevents the notification link from re-triggering generation.
 */
async function handleDELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Queue not available" },
        { status: 503 }
      );
    }

    const { jobId } = await params;
    const connection = await queue.getBackend().client;
    await connection.del(
      `generate-from-url:pages:${jobId}`,
      `generate-from-url:generated:${jobId}`
    );

    return NextResponse.json({ message: "Cleaned up" });
  } catch (error) {
    console.error("Generate from URL cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const DELETE = withRequestRouting(handleDELETE);
