import { internalAppUrl } from "~/lib/internalAppUrl";
import {
  getCrossProjectReportTypes,
  getProjectReportTypes,
} from "~/lib/config/reportTypes";

/**
 * Builds the viewer payload for a stored report configuration: the one shape
 * StaticReportViewer renders, for every report type. The live share route
 * builds it on each open; the frozen-report capture builds it once and stores
 * it, so a frozen link renders exactly what a live one would have.
 */

export type SharedReportPayload = Record<string, any> & {
  results: any[];
  chartData: any[];
  dimensions: any[];
  metrics: any[];
  pagination: {
    totalCount: number;
    page: number;
    pageSize: number | "All";
  };
};

export type BuildSharedReportPayloadResult =
  | { ok: true; payload: SharedReportPayload }
  | { ok: false; status: number; error: string };

export interface BuildSharedReportPayloadOptions {
  /** The stored report configuration (ShareLink.entityConfig). */
  config: any;
  /** The share's project, forwarded to project-scoped report routes. */
  projectId: number | null;
  /**
   * Credentials for the internal report fetches: the share-replay bypass
   * header for a share link, or the caller's own cookie/authorization so the
   * report runs with the caller's permissions.
   */
  authHeaders: Record<string, string>;
}

/**
 * The caller's own credentials (session cookie or API token), for internal
 * report fetches that must run with the caller's permissions.
 */
export function callerAuthHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = req.headers.get("cookie");
  const authorization = req.headers.get("authorization");
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  return headers;
}

export function findReportType(reportTypeId: unknown) {
  const allReportTypes = [
    ...getProjectReportTypes((key: string) => key),
    ...getCrossProjectReportTypes((key: string) => key),
  ];
  return allReportTypes.find((rt) => rt.id === reportTypeId);
}

async function readError(response: Response, fallback: string) {
  const errorData = await response.json().catch(() => null);
  return errorData?.error || fallback;
}

export async function buildSharedReportPayload({
  config,
  projectId,
  authHeaders,
}: BuildSharedReportPayloadOptions): Promise<BuildSharedReportPayloadResult> {
  if (!config || typeof config !== "object") {
    return { ok: false, status: 400, error: "Invalid report configuration" };
  }

  const reportType = findReportType(config.reportType);
  if (!reportType) {
    return { ok: false, status: 400, error: "Unsupported report type" };
  }

  const endpoint = reportType.endpoint;

  // The server's own address, not the browser-facing NEXTAUTH_URL.
  const baseUrl = internalAppUrl();

  // First, fetch metadata (dimensions and metrics with labels) from GET endpoint
  const metadataUrl = new URL(endpoint, baseUrl);
  if (projectId) {
    metadataUrl.searchParams.set("projectId", projectId.toString());
  }

  const metadataResponse = await fetch(metadataUrl.toString(), {
    method: "GET",
    headers: authHeaders,
  });

  if (!metadataResponse.ok) {
    return {
      ok: false,
      status: metadataResponse.status,
      error: await readError(
        metadataResponse,
        "Failed to fetch report metadata"
      ),
    };
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
    // Always include the share's projectId — the saved config may not
    // carry it (project-scoped reports historically relied on the URL
    // query path), but every report route reads it from the body.
    ...(projectId ? { projectId } : {}),
    page: 1,
    pageSize: "All", // Always fetch all results for shared reports
  };

  const reportResponse = await fetch(reportBuilderUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(requestBody),
  });

  if (!reportResponse.ok) {
    return {
      ok: false,
      status: reportResponse.status,
      error: await readError(reportResponse, "Failed to build report"),
    };
  }

  const reportData = await reportResponse.json();

  // Iteration matrix is a 3-axis grid, not a tabular report — the proxy
  // returns the full `AxesShape` ({ caseAxis, configAxis, cells, ... }).
  // Pass it through verbatim as `matrixAxes` so StaticReportViewer can
  // hand it to MatrixReportPreset without re-fetching (the matrix has no
  // public-share aggregation endpoint).
  const isIterationMatrix = config.reportType === "iteration-matrix";
  // Automation candidates is a snapshot-style LLM report — the bypassed
  // POST returns `{snapshot: {...}}`. Pass through verbatim so the
  // viewer renders the persisted snapshot in readOnly mode.
  const isAutomationCandidates = config.reportType === "automation-candidates";

  // Check if this is a pre-built report (empty dimensions/metrics in config)
  // Pre-built reports save empty arrays because they don't use the standard dimension/metric selector
  const isPreBuiltReport =
    (!config.dimensions || config.dimensions.length === 0) &&
    (!config.metrics || config.metrics.length === 0);

  let dimensionsWithLabels: any[] = [];
  let metricsWithLabels: any[] = [];
  let results: any[] = [];
  let chartData: any[] = [];

  if (isIterationMatrix) {
    // Matrix payload lives entirely in the spread below as `matrixAxes`;
    // results/chartData stay empty so the standard table/chart code path
    // is a no-op for the shared matrix surface.
  } else if (isAutomationCandidates) {
    // Same shape as matrix — the snapshot lives in the spread below as
    // `automationCandidatesSnapshot`; rows/chart stay empty.
  } else if (isPreBuiltReport) {
    // Pre-built reports return data in { data: [...] } format
    // Don't generate dimension/metric metadata - let the frontend handle column generation
    results = reportData.data || [];
    // Some pre-built reports (e.g. execution-log) return a separate statusBreakdown
    // array for the chart rather than using the paginated table rows.
    chartData = reportData.statusBreakdown || reportData.data || [];
  } else {
    // Dynamic reports: Map dimension and metric IDs to their full metadata objects
    dimensionsWithLabels = config.dimensions.map((dimId: string) => {
      const metadataDim = metadata.dimensions.find((d: any) => d.id === dimId);
      // ReportChart expects { value, label } format
      return metadataDim
        ? { value: metadataDim.id, label: metadataDim.label }
        : { value: dimId, label: dimId };
    });

    metricsWithLabels = config.metrics.map((metricId: string) => {
      const metadataMetric = metadata.metrics.find(
        (m: any) => m.id === metricId
      );
      // ReportChart expects { value, label } format
      return metadataMetric
        ? { value: metadataMetric.id, label: metadataMetric.label }
        : { value: metricId, label: metricId };
    });

    results = reportData.results;
    chartData = reportData.allResults || reportData.results;
  }

  // Format the response to match what StaticReportViewer expects
  // Note: columns are generated client-side using useReportColumns hook
  const payload: SharedReportPayload = {
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
    ...(reportData.dateGrouping && {
      dateGrouping: reportData.dateGrouping,
    }),
    ...(reportData.consecutiveRuns && {
      consecutiveRuns: reportData.consecutiveRuns,
    }),
    ...(reportData.totalFlakyTests && {
      totalFlakyTests: reportData.totalFlakyTests,
    }),
    ...(isIterationMatrix && {
      matrixAxes: {
        caseAxis: reportData.caseAxis,
        configAxis: reportData.configAxis,
        cells: reportData.cells, // Array<[key, value]> — client reconstructs Map
        cellCount: reportData.cellCount,
        statusMap: reportData.statusMap,
      },
    }),
    ...(isAutomationCandidates && {
      automationCandidatesSnapshot: reportData.snapshot,
    }),
  };

  return { ok: true, payload };
}
