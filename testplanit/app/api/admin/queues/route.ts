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

// GET: Get all queues with their stats
export async function GET(request: NextRequest) {
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

    // Get stats for all queues
    // Default concurrency values from worker configuration
    const defaultConcurrency: Record<string, number> = {
      'forecast-updates': 5,
      'notifications': 5,
      'emails': 3,
      'issue-sync': 2,
      'testmo-imports': 1,
      'elasticsearch-reindex': 2
    };

    // Get configured concurrency from environment (or use defaults)
    const configuredConcurrency: Record<string, number> = {
      'forecast-updates': parseInt(process.env.FORECAST_CONCURRENCY || String(defaultConcurrency['forecast-updates']), 10),
      'notifications': parseInt(process.env.NOTIFICATION_CONCURRENCY || String(defaultConcurrency['notifications']), 10),
      'emails': parseInt(process.env.EMAIL_CONCURRENCY || String(defaultConcurrency['emails']), 10),
      'issue-sync': parseInt(process.env.SYNC_CONCURRENCY || String(defaultConcurrency['issue-sync']), 10),
      'testmo-imports': parseInt(process.env.TESTMO_IMPORT_CONCURRENCY || String(defaultConcurrency['testmo-imports']), 10),
      'elasticsearch-reindex': parseInt(process.env.ELASTICSEARCH_REINDEX_CONCURRENCY || String(defaultConcurrency['elasticsearch-reindex']), 10)
    };

    const queues = [
      { name: 'forecast-updates', queue: forecastQueue },
      { name: 'notifications', queue: notificationQueue },
      { name: 'emails', queue: emailQueue },
      { name: 'issue-sync', queue: syncQueue },
      { name: 'testmo-imports', queue: testmoImportQueue },
      { name: 'elasticsearch-reindex', queue: elasticsearchReindexQueue }
    ];

    const queueStats = await Promise.all(
      queues.map(async ({ name, queue }) => {
        if (!queue) {
          return {
            name,
            error: 'Queue not initialized',
            counts: null,
            isPaused: false,
            concurrency: configuredConcurrency[name] || 1
          };
        }

        try {
          const [counts, isPaused] = await Promise.all([
            queue.getJobCounts(),
            queue.isPaused()
          ]);

          return {
            name,
            counts,
            isPaused,
            error: null,
            concurrency: configuredConcurrency[name] || 1
          };
        } catch (error: any) {
          return {
            name,
            error: error.message,
            counts: null,
            isPaused: false,
            concurrency: configuredConcurrency[name] || 1
          };
        }
      })
    );

    return NextResponse.json({ queues: queueStats });
  } catch (error: any) {
    console.error("Error fetching queue stats:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
