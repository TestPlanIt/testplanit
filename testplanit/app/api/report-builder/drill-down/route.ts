/**
 * API route for report drill-down functionality
 * Fetches underlying records for a clicked metric value
 */

import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import type {
  DrillDownRequest,
  DrillDownResponse,
} from "~/lib/types/reportDrillDown";
import { authOptions } from "~/server/auth";
import {
  buildJunitResultQuery,
  buildTestExecutionQuery,
  getModelForMetric,
  getQueryBuilderForMetric,
} from "~/utils/drillDownQueryBuilders";
import { getFolderSubtreeIds } from "~/utils/reportGrouping";

/**
 * Result-level metrics on the test-execution and user-engagement reports
 * read BOTH sources — manual results (TestRunResults) and automated
 * results (JUnitTestResult) — so their drill-downs must list both.
 * Elapsed metrics additionally restrict to duration-bearing rows.
 */
const ELAPSED_RESULT_METRICS = new Set([
  "avgElapsed",
  "avgElapsedTime",
  "sumElapsed",
  "totalElapsedTime",
  "averageElapsed",
]);
const COUNT_RESULT_METRICS = new Set([
  "testResults",
  "testResultCount",
  "passRate",
  "executionCount",
]);

function isDualSourceResultDrillDown(context: {
  metricId: string;
  reportType: string;
}) {
  const baseReportType = context.reportType.replace(/^cross-project-/, "");
  return (
    (baseReportType === "test-execution" ||
      baseReportType === "user-engagement") &&
    (ELAPSED_RESULT_METRICS.has(context.metricId) ||
      COUNT_RESULT_METRICS.has(context.metricId))
  );
}

/**
 * Combined manual + JUnit drill-down for result-level metric cells. The two
 * sources are paged as one sequential list (all manual rows, then all JUnit
 * rows), each ordered by executedAt desc within its source.
 */
async function handleDualSourceDrillDown(
  context: DrillDownRequest["context"],
  offset: number,
  limit: number
) {
  const isElapsedMetric = ELAPSED_RESULT_METRICS.has(context.metricId);
  const manualQuery = buildTestExecutionQuery(context, offset, limit);
  if (isElapsedMetric) {
    // Only duration-bearing rows feed the elapsed metrics.
    manualQuery.where = { ...manualQuery.where, elapsed: { not: null } };
  }

  const junitQuery = buildJunitResultQuery(context, {
    requireTime: isElapsedMetric,
  });

  const [manualTotal, junitTotal] = await Promise.all([
    baseDb.testRunResults.count({ where: manualQuery.where }),
    junitQuery
      ? baseDb.jUnitTestResult.count({ where: junitQuery.where })
      : Promise.resolve(0),
  ]);

  const data: any[] = [];
  if (offset < manualTotal) {
    const manualRows = await baseDb.testRunResults.findMany({
      ...manualQuery,
      skip: offset,
      take: limit,
    });
    data.push(
      ...manualRows.map((record: any) => ({
        ...record,
        name: record.testRunCase?.repositoryCase?.name || "Unknown Test Case",
      }))
    );
  }

  const remaining = limit - data.length;
  if (junitQuery && remaining > 0) {
    const junitRows = await baseDb.jUnitTestResult.findMany({
      ...junitQuery,
      skip: Math.max(0, offset - manualTotal),
      take: remaining,
    });
    data.push(
      ...junitRows.map((record: any) => ({
        // Manual and JUnit ids can collide numerically; prefix for row keys.
        id: `junit-${record.id}`,
        name: record.repositoryCase?.name || "Unknown Test Case",
        elapsed: record.time,
        executedAt: record.executedAt,
        executedById: record.createdById,
        executedBy: record.createdBy,
        statusId: record.statusId,
        status: record.status,
        testRunId: record.testSuite?.testRun?.id,
        testRun: record.testSuite?.testRun,
        testRunCase: {
          id: null,
          repositoryCase: record.repositoryCase,
        },
      }))
    );
  }

  // Pass-rate cells show a status breakdown; compute it across both
  // sources and judge "passed" by Status.isSuccess (matching the metric).
  let aggregates: DrillDownResponse["aggregates"];
  if (context.metricId === "passRate") {
    const [manualStatus, junitStatus] = await Promise.all([
      baseDb.testRunResults.groupBy({
        by: ["statusId"],
        where: manualQuery.where,
        _count: { id: true },
      }),
      junitQuery
        ? baseDb.jUnitTestResult.groupBy({
            by: ["statusId"],
            where: junitQuery.where,
            _count: { id: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const countByStatus = new Map<number, number>();
    [...manualStatus, ...junitStatus].forEach((row: any) => {
      if (row.statusId == null) return;
      countByStatus.set(
        row.statusId,
        (countByStatus.get(row.statusId) ?? 0) + row._count.id
      );
    });
    const statuses = await baseDb.status.findMany({
      where: { id: { in: [...countByStatus.keys()] } },
      include: { color: true },
    });
    const statusMap = new Map(statuses.map((st: any) => [st.id, st]));
    const statusCounts = [...countByStatus.entries()].map(
      ([statusId, count]) => ({
        statusId,
        statusName: statusMap.get(statusId)?.name || "Unknown",
        statusColor: statusMap.get(statusId)?.color?.value,
        count,
      })
    );
    const passed = [...countByStatus.entries()].reduce(
      (sum, [statusId, count]) =>
        sum + (statusMap.get(statusId)?.isSuccess ? count : 0),
      0
    );
    const grandTotal = manualTotal + junitTotal;
    aggregates = {
      statusCounts,
      passRate: grandTotal > 0 ? (passed / grandTotal) * 100 : 0,
    };
  }

  const total = manualTotal + junitTotal;
  const response: DrillDownResponse = {
    data,
    total,
    hasMore: offset + data.length < total,
    context,
    aggregates,
  };
  return Response.json(response);
}

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

    // Project-scoped drill-downs require read access to the project — the
    // queries below run on the policy-free client with a client-supplied
    // projectId, so the gate lives here (checked through the enhanced
    // client so it follows the app's access rules).
    if (
      context.mode !== "cross-project" &&
      context.projectId &&
      session.user.access !== "ADMIN"
    ) {
      const enhanced = await getEnhancedDb(session);
      const project = await enhanced.projects.findFirst({
        where: { id: Number(context.projectId) },
        select: { id: true },
      });
      if (!project) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // When the folder dimension was rolled up (descendants included), resolve
    // the clicked folder's subtree so the drill-down matches the shown count.
    const folderDimension = context.dimensions?.folder;
    if (
      context.folderIncludeDescendants &&
      folderDimension?.id != null &&
      folderDimension.id !== ""
    ) {
      folderDimension.subtreeIds = await getFolderSubtreeIds(
        baseDb,
        Number(folderDimension.id)
      );
    }

    // Result-level metric cells combine manual and automated results, so
    // their drill-down reads both tables.
    if (isDualSourceResultDrillDown(context)) {
      return await handleDualSourceDrillDown(context, offset, limit);
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
    const model = (baseDb as any)[modelName];
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
