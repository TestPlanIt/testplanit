import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { getElasticsearchReindexQueue } from "@/lib/queues";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { getServerAuthSession } from "~/server/auth";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { ReindexJobData } from "~/workers/elasticsearchReindexWorker";

// Helper to check admin authentication (session or API token)
async function checkAdminAuth(
  request: NextRequest
): Promise<{ error?: NextResponse; userId?: string }> {
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

    if (apiAuth.userId) {
      enrichFromApiAuth({ userId: apiAuth.userId });
    }
  }

  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!userAccess) {
    const user = await baseDb.user.findUnique({
      where: { id: userId },
      select: { access: true },
    });
    userAccess = user?.access;
  }

  if (userAccess !== "ADMIN") {
    return {
      error: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      ),
    };
  }

  return { userId };
}

export const POST = withAuditContext(async (request: NextRequest) => {
  try {
    const auth = await checkAdminAuth(request);
    if (auth.error) return auth.error;

    // Parse request body
    const body = await request.json();
    const { entityType = "all", projectId } = body;

    // Check Elasticsearch connection
    const esClient = getElasticsearchClient();
    if (!esClient) {
      return NextResponse.json(
        {
          error: "Elasticsearch is not configured or unavailable",
        },
        { status: 503 }
      );
    }

    // Check if queue is available
    const elasticsearchReindexQueue = getElasticsearchReindexQueue();
    if (!elasticsearchReindexQueue) {
      return NextResponse.json(
        {
          error: "Background job queue is not available",
        },
        { status: 503 }
      );
    }

    // Add job to queue
    const jobData: ReindexJobData = {
      entityType,
      projectId,
      userId: auth.userId!,
      tenantId: getCurrentTenantId(),
    };

    const job = await enqueueWithAuditContext(
      elasticsearchReindexQueue,
      "reindex",
      jobData
    );

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: "Reindex job queued successfully",
    });
  } catch (error: any) {
    console.error("Admin reindex error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
});

// GET endpoint to check Elasticsearch status
export const GET = withAuditContext(async (request: NextRequest) => {
  try {
    const auth = await checkAdminAuth(request);
    if (auth.error) return auth.error;

    const esClient = getElasticsearchClient();
    if (!esClient) {
      return NextResponse.json({
        available: false,
        message: "Elasticsearch is not configured",
      });
    }

    try {
      const health = await esClient.cluster.health();
      const tenantId = getCurrentTenantId();

      // Filter indices by tenant prefix
      // Multi-tenant: testplanit-{tenantId}-*
      // Single-tenant: testplanit-* (but not testplanit-{anyTenantId}-*)
      const indexPattern = tenantId
        ? `testplanit-${tenantId}-*`
        : "testplanit-*";
      const indices = await esClient.cat.indices({
        index: indexPattern,
        format: "json",
      });

      // In single-tenant mode, filter out any tenant-prefixed indices
      const knownEntities = [
        "repository-cases",
        "shared-steps",
        "test-runs",
        "sessions",
        "projects",
        "issues",
        "milestones",
      ];
      const filteredIndices = tenantId
        ? indices
        : indices.filter((idx: any) => {
            // Single-tenant indices: testplanit-repository-cases
            // Multi-tenant indices: testplanit-tenantid-repository-cases
            // Only show indices matching known single-tenant entity names
            const entityPart = (idx.index || "").replace("testplanit-", "");
            return knownEntities.includes(entityPart);
          });

      return NextResponse.json({
        available: true,
        health: health.status,
        numberOfNodes: health.number_of_nodes,
        indices: filteredIndices.map((idx: any) => ({
          name: idx.index,
          docs: parseInt(idx["docs.count"] || "0"),
          size: idx["store.size"],
          health: idx.health,
        })),
      });
    } catch {
      return NextResponse.json({
        available: false,
        message: "Elasticsearch is not responding",
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
});
