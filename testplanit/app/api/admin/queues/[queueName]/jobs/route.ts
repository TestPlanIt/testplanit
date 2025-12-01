import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { getAllQueues } from "@/lib/queues";
import { Queue } from "bullmq";

function getQueueByName(queueName: string): Queue | null {
  const allQueues = getAllQueues();
  const queueMap: Record<string, Queue | null> = {
    'forecast-updates': allQueues.forecastQueue,
    'notifications': allQueues.notificationQueue,
    'emails': allQueues.emailQueue,
    'issue-sync': allQueues.syncQueue,
    'testmo-imports': allQueues.testmoImportQueue,
    'elasticsearch-reindex': allQueues.elasticsearchReindexQueue
  };
  return queueMap[queueName] ?? null;
}

// GET: Get jobs from a specific queue
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ queueName: string }> }
) {
  try {
    const session = await getServerAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true }
    });

    if (user?.access !== 'ADMIN') {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { queueName } = await params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state') || 'all';
    const start = parseInt(searchParams.get('start') || '0');
    const end = parseInt(searchParams.get('end') || '50');

    let jobs;
    if (state === 'all') {
      // Get jobs from all states
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getJobs(['waiting'], start, end),
        queue.getJobs(['active'], start, end),
        queue.getJobs(['completed'], start, end),
        queue.getJobs(['failed'], start, end),
        queue.getJobs(['delayed'], start, end)
      ]);

      jobs = [...waiting, ...active, ...completed, ...failed, ...delayed];
    } else {
      jobs = await queue.getJobs([state as any], start, end);
    }

    // Format jobs for response
    const formattedJobs = await Promise.all(
      jobs.map(async (job) => {
        const state = await job.getState();
        return {
          id: job.id,
          name: job.name,
          data: job.data,
          opts: job.opts,
          progress: job.progress,
          returnvalue: job.returnvalue,
          stacktrace: job.stacktrace,
          timestamp: job.timestamp,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
          finishedOn: job.finishedOn,
          processedOn: job.processedOn,
          state
        };
      })
    );

    return NextResponse.json({ jobs: formattedJobs });
  } catch (error: any) {
    console.error("Error fetching queue jobs:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
