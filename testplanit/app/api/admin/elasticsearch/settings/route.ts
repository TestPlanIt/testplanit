import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { auditSystemConfigChange } from "~/lib/services/auditLog";

// GET: Retrieve current replica settings
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

    // Get settings from database
    const config = await prisma.appConfig.findUnique({
      where: { key: "elasticsearch_replicas" }
    });

    return NextResponse.json({
      numberOfReplicas: config?.value ? (config.value as number) : 0
    });
  } catch (error: any) {
    console.error("Error fetching Elasticsearch settings:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: Save replica settings to database
export async function POST(request: NextRequest) {
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

    const { numberOfReplicas } = await request.json();

    // Validate input
    if (typeof numberOfReplicas !== 'number' || numberOfReplicas < 0 || numberOfReplicas > 10) {
      return NextResponse.json(
        { error: "Invalid number of replicas. Must be between 0 and 10." },
        { status: 400 }
      );
    }

    // Get old value for audit
    const oldConfig = await prisma.appConfig.findUnique({
      where: { key: "elasticsearch_replicas" }
    });
    const oldValue = oldConfig?.value ?? null;

    // Save to database
    await prisma.appConfig.upsert({
      where: { key: "elasticsearch_replicas" },
      update: { value: numberOfReplicas },
      create: {
        key: "elasticsearch_replicas",
        value: numberOfReplicas
      }
    });

    // Audit the config change
    auditSystemConfigChange("elasticsearch_replicas", oldValue, numberOfReplicas).catch(
      (error) => console.error("[AuditLog] Failed to audit ES settings change:", error)
    );

    return NextResponse.json({ success: true, numberOfReplicas });
  } catch (error: any) {
    console.error("Error saving Elasticsearch settings:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Update existing indices with new replica settings
export async function PUT(request: NextRequest) {
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

    const { numberOfReplicas } = await request.json();

    // Validate input
    if (typeof numberOfReplicas !== 'number' || numberOfReplicas < 0 || numberOfReplicas > 10) {
      return NextResponse.json(
        { error: "Invalid number of replicas. Must be between 0 and 10." },
        { status: 400 }
      );
    }

    const esClient = getElasticsearchClient();
    if (!esClient) {
      return NextResponse.json(
        { error: "Elasticsearch is not configured" },
        { status: 503 }
      );
    }

    try {
      // Update all TestPlanIt indices
      await esClient.indices.putSettings({
        index: "testplanit-*",
        settings: {
          index: {
            number_of_replicas: numberOfReplicas
          }
        }
      });

      // Get updated health status
      const health = await esClient.cluster.health();

      return NextResponse.json({
        success: true,
        numberOfReplicas,
        clusterHealth: health.status
      });
    } catch (esError: any) {
      console.error("Error updating Elasticsearch indices:", esError);
      return NextResponse.json(
        { 
          error: "Failed to update Elasticsearch indices",
          details: esError.message 
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Error updating Elasticsearch replica settings:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}