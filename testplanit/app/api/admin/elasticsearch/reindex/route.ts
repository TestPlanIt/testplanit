import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { getElasticsearchReindexQueue } from "@/lib/queues";
import { ReindexJobData } from "~/workers/elasticsearchReindexWorker";

export async function POST(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const { entityType = "all", projectId } = body;

    // Check Elasticsearch connection
    const esClient = getElasticsearchClient();
    if (!esClient) {
      return NextResponse.json({
        error: "Elasticsearch is not configured or unavailable"
      }, { status: 503 });
    }

    // Check if queue is available
    const elasticsearchReindexQueue = getElasticsearchReindexQueue();
    if (!elasticsearchReindexQueue) {
      return NextResponse.json({
        error: "Background job queue is not available"
      }, { status: 503 });
    }

    // Add job to queue
    const jobData: ReindexJobData = {
      entityType,
      projectId,
      userId: session.user.id,
    };

    const job = await elasticsearchReindexQueue.add("reindex", jobData);

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: "Reindex job queued successfully"
    });
  } catch (error: any) {
    console.error("Admin reindex error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// GET endpoint to check Elasticsearch status
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

    const esClient = getElasticsearchClient();
    if (!esClient) {
      return NextResponse.json({ 
        available: false,
        message: "Elasticsearch is not configured" 
      });
    }

    try {
      const health = await esClient.cluster.health();
      const indices = await esClient.cat.indices({ format: "json" });
      
      return NextResponse.json({
        available: true,
        health: health.status,
        numberOfNodes: health.number_of_nodes,
        indices: indices.map((idx: any) => ({
          name: idx.index,
          docs: parseInt(idx["docs.count"] || "0"),
          size: idx["store.size"],
          health: idx.health
        }))
      });
    } catch (error) {
      return NextResponse.json({
        available: false,
        message: "Elasticsearch is not responding"
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}