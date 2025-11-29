import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { elasticsearchReindexQueue } from "@/lib/queues";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    // Check authentication
    const session = await getServerAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true }
    });

    if (user?.access !== 'ADMIN') {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Check if queue is available
    if (!elasticsearchReindexQueue) {
      return NextResponse.json({
        error: "Background job queue is not available"
      }, { status: 503 });
    }

    const { jobId } = await params;
    const job = await elasticsearchReindexQueue.getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    const state = await job.getState();
    const progress = job.progress;

    // Get job logs from Redis
    const logsKey = `bull:${elasticsearchReindexQueue.name}:${jobId}:logs`;
    const connection = await elasticsearchReindexQueue.client;
    const logs = await connection.lrange(logsKey, 0, -1);

    let result = null;
    let failedReason = null;

    if (state === "completed") {
      result = job.returnvalue;
    } else if (state === "failed") {
      failedReason = job.failedReason;
    }

    return NextResponse.json({
      jobId: job.id,
      state,
      progress,
      logs: logs || [],
      result,
      failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    });
  } catch (error: any) {
    console.error("Job status error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
