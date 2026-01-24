import { NextRequest, NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { getProjectReportTypes, getCrossProjectReportTypes } from "~/lib/config/reportTypes";

export const dynamic = "force-dynamic";

/**
 * GET /api/share/[shareKey]/report
 * Fetch report data for a shared link (public access)
 * This endpoint is accessible without authentication for PUBLIC and PASSWORD_PROTECTED shares
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareKey: string }> }
) {
  try {
    const { shareKey } = await params;
    const session = await getServerSession(authOptions);

    // Get token from query params (for password-protected shares)
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    // Fetch share link
    const shareLink = await prisma.shareLink.findUnique({
      where: { shareKey },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            createdBy: true,
            userPermissions: {
              where: session?.user?.id
                ? { userId: session.user.id }
                : undefined,
            },
          },
        },
      },
    });

    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    // Check if revoked
    if (shareLink.isRevoked) {
      return NextResponse.json(
        { error: "This share link has been revoked" },
        { status: 403 }
      );
    }

    // Check if expired
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 403 }
      );
    }

    // Handle PASSWORD_PROTECTED mode
    if (shareLink.mode === "PASSWORD_PROTECTED") {
      // Check if user has project access (bypass password)
      if (session) {
        const hasProjectAccess =
          session.user.access === "ADMIN" ||
          !shareLink.project ||
          shareLink.project.createdBy === session.user.id ||
          shareLink.project.userPermissions.length > 0;

        if (!hasProjectAccess && token !== shareKey) {
          return NextResponse.json(
            { error: "Valid token required" },
            { status: 401 }
          );
        }
      } else {
        // Not logged in, require valid token
        if (token !== shareKey) {
          return NextResponse.json(
            { error: "Valid token required" },
            { status: 401 }
          );
        }
      }
    }

    // Handle AUTHENTICATED mode
    if (shareLink.mode === "AUTHENTICATED") {
      if (!session) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      const hasProjectAccess =
        session.user.access === "ADMIN" ||
        !shareLink.project ||
        shareLink.project.createdBy === session.user.id ||
        shareLink.project.userPermissions.length > 0;

      if (!hasProjectAccess) {
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 }
        );
      }
    }

    // Only REPORT entity type is supported for now
    if (shareLink.entityType !== "REPORT") {
      return NextResponse.json(
        { error: "Only report shares are supported" },
        { status: 400 }
      );
    }

    const config = shareLink.entityConfig as any;
    if (!config) {
      return NextResponse.json(
        { error: "Invalid report configuration" },
        { status: 400 }
      );
    }

    // Get all available report types
    const projectReportTypes = getProjectReportTypes((key: string) => key);
    const crossProjectReportTypes = getCrossProjectReportTypes((key: string) => key);
    const allReportTypes = [...projectReportTypes, ...crossProjectReportTypes];

    // Find the report type configuration
    const reportType = allReportTypes.find((rt) => rt.id === config.reportType);
    if (!reportType) {
      return NextResponse.json(
        { error: "Unsupported report type" },
        { status: 400 }
      );
    }

    const endpoint = reportType.endpoint;

    // Use localhost for internal server-to-server communication to avoid SSL issues
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    // First, fetch metadata (dimensions and metrics with labels) from GET endpoint
    const metadataUrl = new URL(endpoint, baseUrl);
    if (shareLink.projectId) {
      metadataUrl.searchParams.set("projectId", shareLink.projectId.toString());
    }

    const metadataResponse = await fetch(metadataUrl.toString(), {
      method: "GET",
      headers: {
        // Forward cookies for authentication if user is logged in
        ...(req.headers.get("cookie")
          ? { Cookie: req.headers.get("cookie")! }
          : {}),
        // Add bypass header for shared reports to allow access without admin permissions
        "x-shared-report-bypass": "true",
      },
    });

    if (!metadataResponse.ok) {
      const errorData = await metadataResponse.json();
      return NextResponse.json(
        { error: errorData.error || "Failed to fetch report metadata" },
        { status: metadataResponse.status }
      );
    }

    const metadata = await metadataResponse.json();

    // Then, call the report builder POST endpoint to get data
    // Always fetch ALL results for shared reports (ignore saved pagination settings)
    const reportBuilderUrl = new URL(endpoint, baseUrl);

    // Forward ALL config parameters to the report endpoint (generic approach)
    // This ensures pre-built reports get all their required parameters
    const { reportType: _, ...requestParams } = config;
    const requestBody = {
      ...requestParams, // Spread all saved parameters from the config
      page: 1,
      pageSize: "All", // Always fetch all results for shared reports
    };

    const reportResponse = await fetch(reportBuilderUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward cookies for authentication if user is logged in
        ...(req.headers.get("cookie")
          ? { Cookie: req.headers.get("cookie")! }
          : {}),
        // Add bypass header for shared reports to allow access without admin permissions
        "x-shared-report-bypass": "true",
      },
      body: JSON.stringify(requestBody),
    });

    if (!reportResponse.ok) {
      const errorData = await reportResponse.json();
      return NextResponse.json(
        { error: errorData.error || "Failed to build report" },
        { status: reportResponse.status }
      );
    }

    const reportData = await reportResponse.json();

    // Check if this is a pre-built report (empty dimensions/metrics in config)
    // Pre-built reports save empty arrays because they don't use the standard dimension/metric selector
    const isPreBuiltReport = (!config.dimensions || config.dimensions.length === 0) &&
                             (!config.metrics || config.metrics.length === 0);

    let dimensionsWithLabels: any[] = [];
    let metricsWithLabels: any[] = [];
    let results: any[] = [];
    let chartData: any[] = [];

    if (isPreBuiltReport) {
      // Pre-built reports return data in { data: [...] } format
      // Don't generate dimension/metric metadata - let the frontend handle column generation
      results = reportData.data || [];
      chartData = reportData.data || [];
      // Leave dimensions and metrics empty for pre-built reports
      dimensionsWithLabels = [];
      metricsWithLabels = [];
    } else {
      // Dynamic reports: Map dimension and metric IDs to their full metadata objects
      dimensionsWithLabels = config.dimensions.map((dimId: string) => {
        const metadataDim = metadata.dimensions.find((d: any) => d.id === dimId);
        // ReportChart expects { value, label } format
        return metadataDim ? { value: metadataDim.id, label: metadataDim.label } : { value: dimId, label: dimId };
      });

      metricsWithLabels = config.metrics.map((metricId: string) => {
        const metadataMetric = metadata.metrics.find((m: any) => m.id === metricId);
        // ReportChart expects { value, label } format
        return metadataMetric ? { value: metadataMetric.id, label: metadataMetric.label } : { value: metricId, label: metricId };
      });

      results = reportData.results;
      chartData = reportData.allResults || reportData.results;
    }

    // Format the response to match what StaticReportViewer expects
    // Note: columns are generated client-side using useReportColumns hook
    const responsePayload = {
      results,
      chartData,
      dimensions: dimensionsWithLabels,
      metrics: metricsWithLabels,
      pagination: {
        totalCount: reportData.totalCount || reportData.total || results.length,
        page: reportData.page || 1,
        pageSize: reportData.pageSize || "All",
      },
      // Pass through additional fields for specialized reports (automation-trends, flaky-tests, etc.)
      ...(reportData.projects && { projects: reportData.projects }),
      ...(reportData.dateGrouping && { dateGrouping: reportData.dateGrouping }),
      ...(reportData.consecutiveRuns && { consecutiveRuns: reportData.consecutiveRuns }),
      ...(reportData.totalFlakyTests && { totalFlakyTests: reportData.totalFlakyTests }),
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error("Error fetching report data for share:", error);
    return NextResponse.json(
      { error: "Failed to load report data" },
      { status: 500 }
    );
  }
}
