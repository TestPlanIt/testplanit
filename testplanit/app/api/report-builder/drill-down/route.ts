/**
 * API route for report drill-down functionality
 * Fetches underlying records for a clicked metric value
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import type {
  DrillDownRequest,
  DrillDownResponse,
} from "~/lib/types/reportDrillDown";
import {
  getQueryBuilderForMetric,
  getModelForMetric,
} from "~/utils/drillDownQueryBuilders";

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body: DrillDownRequest = await req.json();
    const { context, offset = 0, limit = 50 } = body;

    // Validate required fields
    if (!context || !context.metricId || !context.reportType) {
      return Response.json(
        { error: "Invalid drill-down context" },
        { status: 400 }
      );
    }

    // Check admin access for cross-project reports
    if (context.mode === "cross-project" && session.user.access !== "ADMIN") {
      return Response.json(
        { error: "Admin access required for cross-project drill-down" },
        { status: 403 }
      );
    }

    // Get the appropriate query builder for this metric
    const queryBuilder = getQueryBuilderForMetric(
      context.metricId,
      context.reportType
    );
    const modelName = getModelForMetric(context.metricId);

    // Build the query
    const query = queryBuilder(context, offset, limit);

    // Execute the query using dynamic model access
    const model = (prisma as any)[modelName];
    if (!model) {
      return Response.json(
        { error: `Invalid model: ${modelName}` },
        { status: 400 }
      );
    }

    // Fetch data and count in parallel
    const [rawData, total] = await Promise.all([
      model.findMany(query),
      model.count({ where: query.where }),
    ]);

    // Calculate aggregates for pass rate metrics
    let aggregates: DrillDownResponse["aggregates"];
    if (context.metricId === "passRate") {
      // Group by status to get counts
      const statusCounts = await model.groupBy({
        by: ["statusId"],
        where: query.where,
        _count: {
          id: true,
        },
      });

      // Fetch status details for each group
      const statusIds = statusCounts.map((sc: any) => sc.statusId);
      const statuses = await prisma.status.findMany({
        where: { id: { in: statusIds } },
        include: { color: true },
      });

      // Map status counts with details
      const statusMap = new Map(statuses.map((s: any) => [s.id, s]));
      const statusCountsWithDetails = statusCounts.map((sc: any) => {
        const status = statusMap.get(sc.statusId);
        return {
          statusId: sc.statusId,
          statusName: status?.name || "Unknown",
          statusColor: status?.color?.value,
          count: sc._count.id,
        };
      });

      // Calculate pass rate
      const passedCount =
        statusCountsWithDetails.find(
          (sc: { statusName: string; count: number }) =>
            sc.statusName.toLowerCase() === "passed"
        )?.count || 0;
      const passRate = total > 0 ? (passedCount / total) * 100 : 0;

      aggregates = {
        statusCounts: statusCountsWithDetails,
        passRate,
      };
    }

    // Transform data to ensure 'name' field is populated correctly
    const data = rawData.map((record: any) => {
      // For test execution records, use the test case name
      if (
        context.metricId === "testResults" ||
        context.metricId === "passRate" ||
        context.metricId === "avgElapsed" ||
        context.metricId === "sumElapsed"
      ) {
        return {
          ...record,
          name: record.testRunCase?.repositoryCase?.name || "Unknown Test Case",
        };
      }
      // For other records, name should already be correct
      return record;
    });

    // Calculate if there are more records
    const hasMore = offset + data.length < total;

    const response: DrillDownResponse = {
      data,
      total,
      hasMore,
      context,
      aggregates,
    };

    return Response.json(response);
  } catch (error: any) {
    console.error("Drill-down error:", error);
    return Response.json(
      { error: error.message || "Failed to fetch drill-down data" },
      { status: 500 }
    );
  }
}
