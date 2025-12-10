import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "@/lib/prisma";
import { getAllQueues } from "@/lib/queues";
import { Queue } from "bullmq";

// Helper to check admin authentication (session or API token)
async function checkAdminAuth(request: NextRequest): Promise<{ error?: NextResponse; userId?: string }> {
  const session = await getServerAuthSession();
  let userId = session?.user?.id;
  let userAccess: string | undefined;

  if (!userId) {
    const apiAuth = await authenticateApiToken(request);
    if (!apiAuth.authenticated) {
      return {
        error: NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        ),
      };
    }
    userId = apiAuth.userId;
    userAccess = apiAuth.access;
  }

  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!userAccess) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { access: true },
    });
    userAccess = user?.access;
  }

  if (userAccess !== "ADMIN") {
    return {
      error: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return { userId };
}

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

      // All attempts failed
      throw new Error(`Failed to remove locked job after ${maxAttempts} attempts. ${isRepeatable ? 'The repeatable schedule has been removed, but this job instance is still locked. ' : ''}Try again later or restart the worker.`);
    } else {
      throw error;
    }
  }

  return true;
}

// POST: Perform actions on the queue (pause, resume, clean, drain, obliterate)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ queueName: string }> }
) {
  try {
    const auth = await checkAdminAuth(request);
    if (auth.error) return auth.error;

    const { queueName } = await params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }

    const { action, grace, limit, jobTypes } = await request.json();

    switch (action) {
      case 'pause':
        await queue.pause();
        return NextResponse.json({ success: true, message: 'Queue paused' });

      case 'resume':
        await queue.resume();
        return NextResponse.json({ success: true, message: 'Queue resumed' });

      case 'clean':
        // Clean completed and failed jobs
        const cleanOptions = {
          grace: grace || 0, // Grace period in milliseconds
          limit: limit || 100 // Max number of jobs to clean
        };

        const completedCleaned = await queue.clean(cleanOptions.grace, cleanOptions.limit, 'completed');
        const failedCleaned = await queue.clean(cleanOptions.grace, cleanOptions.limit, 'failed');

        return NextResponse.json({
          success: true,
          message: 'Queue cleaned',
          cleaned: {
            completed: completedCleaned.length,
            failed: failedCleaned.length,
            total: completedCleaned.length + failedCleaned.length
          }
        });

      case 'drain':
        // Remove all waiting jobs
        await queue.drain();
        return NextResponse.json({ success: true, message: 'Queue drained (all waiting jobs removed)' });

      case 'obliterate':
        // DANGEROUS: Completely wipe the queue
        await queue.obliterate({ force: true });
        return NextResponse.json({ success: true, message: 'Queue obliterated (all data removed)' });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Error performing queue action:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: Remove a specific job from the queue
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ queueName: string }> }
) {
  try {
    const auth = await checkAdminAuth(request);
    if (auth.error) return auth.error;

    const { queueName } = await params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const force = searchParams.get('force') === 'true';

    if (!jobId) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

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
