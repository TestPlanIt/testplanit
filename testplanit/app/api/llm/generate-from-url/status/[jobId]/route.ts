import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantPrisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getGenerateFromUrlQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
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
        { status: 503 },
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
          { status: 500 },
        );
      }
      if (job.data?.tenantId !== currentTenantId) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
    }

    const state = await job.getState();

    // BullMQ may return returnvalue as a JSON string or parsed object
    // depending on how it was stored/retrieved. Ensure it's always an object.
    let result = null;
    if (state === "completed" && job.returnvalue != null) {
      result =
        typeof job.returnvalue === "string"
          ? JSON.parse(job.returnvalue)
          : job.returnvalue;
    }

    // For crawl-only jobs, check for saved generated test cases first,
    // then fall back to loading crawled page content from Redis.
    let generatedTestCases = null;
    if (state === "completed" && result?.crawlOnly) {
      try {
        const connection = await queue.client;

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
      jobId: job.id,
      state,
      progress: job.progress,
      result,
      generatedTestCases,
      failedReason: state === "failed" ? job.failedReason : null,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    });
  } catch (error) {
    console.error("Generate from URL status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * PUT: Save generated test cases to Redis so the notification link
 * can restore them without re-running LLM generation.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json({ error: "Queue not available" }, { status: 503 });
    }

    const { jobId } = await params;
    const body = await request.json();

    const connection = await queue.client;
    await connection.set(
      `generate-from-url:generated:${jobId}`,
      JSON.stringify(body),
      "EX",
      86400, // 24 hour TTL
    );

    return NextResponse.json({ message: "Saved" });
  } catch (error) {
    console.error("Generate from URL save error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE: Clean up crawled page content and generated results from Redis after import.
 * Prevents the notification link from re-triggering generation.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json({ error: "Queue not available" }, { status: 503 });
    }

    const { jobId } = await params;
    const connection = await queue.client;
    await connection.del(
      `generate-from-url:pages:${jobId}`,
      `generate-from-url:generated:${jobId}`,
    );

    return NextResponse.json({ message: "Cleaned up" });
  } catch (error) {
    console.error("Generate from URL cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
