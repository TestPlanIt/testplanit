import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import valkeyConnection from "~/lib/valkey";
import { getVersionInfo } from "~/lib/version";
import { db } from "~/server/db";
import { getElasticsearchClient } from "~/services/elasticsearchService";

export const dynamic = "force-dynamic";

interface ServiceCheck {
  status: "ok" | "error" | "disabled";
  message?: string;
  responseTime?: number;
}

/** Event-loop delay percentiles, milliseconds. */
export interface EventLoopLag {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  /** How long the histogram has been collecting. Makes the percentiles readable. */
  sinceMs: number;
}

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  gitCommit: string;
  gitBranch: string;
  gitTag: string;
  buildDate: string;
  environment: string;
  isTaggedRelease: boolean;
  checks: {
    database: ServiceCheck;
    redis: ServiceCheck;
    elasticsearch: ServiceCheck;
    storage: ServiceCheck;
  };
  /**
   * Deliberately a sibling of `checks`, not a member of it: everything under
   * `checks` feeds the overall `status`, and this must NOT. See getEventLoopLag.
   */
  eventLoop: EventLoopLag;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Event-loop delay
// ---------------------------------------------------------------------------
// The app is a single `next-server` process, so all JS for every request runs on
// ONE thread and that thread is the real capacity ceiling. Container CPU% does
// not show it: on 2026-08-11 `docker stats` read 276% on this container while
// the actual bottleneck was one JS thread at 90%, and Postgres read 101% one
// second and 0.22% the next. Event-loop delay measures the thing that actually
// makes requests slow — how long work waits for the thread.
//
// Read it against nginx's `rt`/`urt` (see nginx.conf's `timed` log_format):
// high urt plus high lag here means the loop is saturated; high urt with low lag
// points at a slow query or upstream instead.

let eventLoopHistogram: IntervalHistogram | null = null;
let eventLoopStartedAt = 0;

/**
 * Lazily created so merely importing this route — in a unit test, or during
 * Next's build-time module trace — never starts a monitor.
 *
 * Never reset. Two reasons: this is for capacity work, which wants the
 * distribution over hours rather than the last few seconds; and reset-on-read
 * would let two pollers (the container healthcheck and a human curl) silently
 * truncate each other's window.
 *
 * It never affects the overall `status`. Making a blocked loop report
 * "unhealthy" would pull an instance out of the load balancer exactly when it is
 * busiest, shifting its traffic onto its sibling and taking that one down too.
 * This is a gauge to alert on, not a readiness signal.
 */
function getEventLoopLag(): EventLoopLag {
  if (!eventLoopHistogram) {
    // 10ms sampling: cheap, and blocks shorter than that don't matter here.
    eventLoopHistogram = monitorEventLoopDelay({ resolution: 10 });
    eventLoopHistogram.enable();
    eventLoopStartedAt = Date.now();
  }

  // perf_hooks reports nanoseconds; percentiles on an empty histogram are 0.
  const toMs = (ns: number) =>
    Number.isFinite(ns) ? Math.round(ns / 1e4) / 100 : 0;

  return {
    p50: toMs(eventLoopHistogram.percentile(50)),
    p90: toMs(eventLoopHistogram.percentile(90)),
    p99: toMs(eventLoopHistogram.percentile(99)),
    max: toMs(eventLoopHistogram.max),
    sinceMs: Date.now() - eventLoopStartedAt,
  };
}

export async function GET() {
  const versionInfo = getVersionInfo();

  // Check database connectivity
  const databaseCheck: ServiceCheck = await checkDatabase();

  // Check Redis/Valkey connectivity
  const redisCheck: ServiceCheck = await checkRedis();

  // Check Elasticsearch connectivity
  const elasticsearchCheck: ServiceCheck = await checkElasticsearch();

  // Check S3/MinIO storage connectivity
  const storageCheck: ServiceCheck = await checkStorage();

  // Determine overall health status
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";

  // Critical services: database is required for the app to function
  if (databaseCheck.status === "error") {
    status = "unhealthy";
  }
  // Non-critical services: redis, elasticsearch, storage
  // If any are down, the app is degraded but still functional
  else if (
    redisCheck.status === "error" ||
    elasticsearchCheck.status === "error" ||
    storageCheck.status === "error"
  ) {
    status = "degraded";
  }

  const response: HealthCheckResponse = {
    status,
    version: versionInfo.version,
    gitCommit: versionInfo.gitCommit,
    gitBranch: versionInfo.gitBranch,
    gitTag: versionInfo.gitTag,
    buildDate: versionInfo.buildDate,
    environment: versionInfo.environment,
    isTaggedRelease: versionInfo.gitTag === `v${versionInfo.version}`,
    checks: {
      database: databaseCheck,
      redis: redisCheck,
      elasticsearch: elasticsearchCheck,
      storage: storageCheck,
    },
    eventLoop: getEventLoopLag(),
    timestamp: new Date().toISOString(),
  };

  // Return appropriate HTTP status code based on health
  const httpStatus =
    status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

  // Add CORS headers to allow cross-origin requests
  // Health check is public information, so we allow all origins
  return NextResponse.json(response, {
    status: httpStatus,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// Handle preflight OPTIONS request for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

async function checkDatabase(): Promise<ServiceCheck> {
  try {
    const startTime = Date.now();
    await db.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Database health check failed:", error);
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unknown database error",
    };
  }
}

async function checkRedis(): Promise<ServiceCheck> {
  if (!valkeyConnection) {
    return {
      status: "disabled",
      message: "Redis/Valkey not configured",
    };
  }

  try {
    const startTime = Date.now();
    await valkeyConnection.ping();
    return {
      status: "ok",
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Redis health check failed:", error);
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown Redis error",
    };
  }
}

async function checkElasticsearch(): Promise<ServiceCheck> {
  const client = getElasticsearchClient();

  if (!client) {
    return {
      status: "disabled",
      message: "Elasticsearch not configured",
    };
  }

  try {
    const startTime = Date.now();
    await client.ping();
    return {
      status: "ok",
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Elasticsearch health check failed:", error);
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unknown Elasticsearch error",
    };
  }
}

async function checkStorage(): Promise<ServiceCheck> {
  // Check if S3/MinIO is configured
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      status: "disabled",
      message: "S3/MinIO not configured",
    };
  }

  try {
    const startTime = Date.now();

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      endpoint: process.env.AWS_ENDPOINT_URL,
      forcePathStyle: process.env.AWS_ENDPOINT_URL ? true : false,
    });

    // Simple check - list buckets to verify connectivity
    await s3Client.send(new ListBucketsCommand({}));

    return {
      status: "ok",
      responseTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Storage health check failed:", error);
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown storage error",
    };
  }
}
