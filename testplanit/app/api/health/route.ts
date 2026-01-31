import { NextResponse } from "next/server";
import { getVersionInfo } from "~/lib/version";
import { db } from "~/server/db";
import valkeyConnection from "~/lib/valkey";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";

export const dynamic = "force-dynamic";

interface ServiceCheck {
  status: "ok" | "error" | "disabled";
  message?: string;
  responseTime?: number;
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
  timestamp: string;
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
    timestamp: new Date().toISOString(),
  };

  // Return appropriate HTTP status code based on health
  const httpStatus = status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

  return NextResponse.json(response, { status: httpStatus });
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
      message: error instanceof Error ? error.message : "Unknown database error",
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
      message: error instanceof Error ? error.message : "Unknown Elasticsearch error",
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
