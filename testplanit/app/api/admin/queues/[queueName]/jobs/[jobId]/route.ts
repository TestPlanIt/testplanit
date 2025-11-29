import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import {
  forecastQueue,
  notificationQueue,
  emailQueue,
  syncQueue,
  testmoImportQueue,
  elasticsearchReindexQueue
} from "@/lib/queues";
import { Queue } from "bullmq";

const queueMap: Record<string, Queue | null> = {
  'forecast-updates': forecastQueue,
  'notifications': notificationQueue,
  'emails': emailQueue,
  'issue-sync': syncQueue,
  'testmo-imports': testmoImportQueue,
  'elasticsearch-reindex': elasticsearchReindexQueue
};

// Helper function to safely remove a job (handles both regular and repeatable jobs)
async function removeJob(
  queue: Queue,
  job: any,
  force: boolean = false
): Promise<boolean | { partialSuccess: true; message: string }> {
  const jobId = job.id as string;
  let isRepeatable = false;
  let repeatKey: string | undefined;

  // Check if this is a repeatable job (ID starts with "repeat:")
  if (jobId && jobId.startsWith('repeat:')) {
    isRepeatable = true;
    // Extract the repeat key from the job ID format: repeat:{key}:{timestamp}
    const parts = jobId.split(':');
    if (parts.length >= 2) {
      repeatKey = parts[1];
    }
  }

  // Check if job is currently locked (active)
  const state = await job.getState();
  if (state === 'active' && !force) {
    const jobType = isRepeatable ? 'active scheduled' : 'active';
    throw new Error(`Cannot remove ${jobType} job. The job is currently being processed by a worker. Please wait for it to complete or use force removal.`);
  }

  // For repeatable jobs, remove the schedule first
  if (isRepeatable && repeatKey) {
    try {
      // Get all repeatable jobs to find the one with matching key
      const repeatableJobs = await queue.getRepeatableJobs();
      const repeatableJob = repeatableJobs.find(rj => rj.key === repeatKey);

      if (repeatableJob) {
        // Remove the repeatable schedule (prevents future jobs)
        await queue.removeRepeatableByKey(repeatKey);
      }
    } catch (error: any) {
      console.warn('Failed to remove repeatable schedule:', error.message);
      // Continue anyway to try to remove the current instance
    }
  }

  // Now try to remove the current job instance
  try {
    await job.remove();
  } catch (error: any) {
    if (error.message?.includes('locked')) {
      if (!force) {
        throw new Error('Job is locked by a worker. Use force removal to remove it anyway.');
      }

      // Force removal: Try multiple times with delays
      let attempts = 0;
      const maxAttempts = 3;
      let lastError = error;

      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 200 * attempts));

        try {
          await job.remove();
          return true; // Success!
        } catch (retryError: any) {
          lastError = retryError;
          if (!retryError.message?.includes('locked')) {
            throw retryError; // Different error, throw it
          }
        }
      }

      // All attempts failed - but for repeatable jobs, this is a partial success
      if (isRepeatable) {
        console.warn(`Repeatable job instance ${jobId} is still locked, but schedule has been removed.`);
        // Return success since the schedule is gone - this instance will eventually timeout
        return {
          partialSuccess: true,
          message: 'The repeatable schedule has been removed successfully. This specific job instance is still locked by a worker that may have crashed. It will not recur. The lock will automatically expire, or you can restart the worker to clear it.'
        };
      }

      throw new Error(`Failed to remove locked job after ${maxAttempts} attempts. Try again later or restart the worker.`);
    } else {
      throw error;
    }
  }

  return true;
}

// GET: Get detailed information about a specific job
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ queueName: string; jobId: string }> }
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

    const { queueName, jobId } = await params;
    const queue = queueMap[queueName];

    if (!queue) {
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }

    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const state = await job.getState();
    const logs = await queue.getJobLogs(jobId);

    return NextResponse.json({
      job: {
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
        state,
        logs
      }
    });
  } catch (error: any) {
    console.error("Error fetching job details:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: Perform actions on a specific job (retry, promote)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ queueName: string; jobId: string }> }
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

    const { queueName, jobId } = await params;
    const queue = queueMap[queueName];

    if (!queue) {
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }

    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { action, force = false } = await request.json();

    switch (action) {
      case 'retry':
        await job.retry();
        return NextResponse.json({ success: true, message: 'Job retried' });

      case 'promote':
        await job.promote();
        return NextResponse.json({ success: true, message: 'Job promoted' });

      case 'remove': {
        const result = await removeJob(queue, job, force);
        // Handle partial success (repeatable job schedule removed but instance locked)
        if (typeof result === 'object' && result.partialSuccess) {
          return NextResponse.json({
            success: true,
            partialSuccess: true,
            message: result.message
          });
        }
        return NextResponse.json({ success: true, message: 'Job removed' });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Error performing job action:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: Remove a specific job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ queueName: string; jobId: string }> }
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

    const { queueName, jobId } = await params;
    const queue = queueMap[queueName];

    if (!queue) {
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }

    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check for force parameter in query string
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';

    const result = await removeJob(queue, job, force);

    // Handle partial success (repeatable job schedule removed but instance locked)
    if (typeof result === 'object' && result.partialSuccess) {
      return NextResponse.json({
        success: true,
        partialSuccess: true,
        message: result.message
      });
    }

    return NextResponse.json({ success: true, message: 'Job removed' });
  } catch (error: any) {
    console.error("Error removing job:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
