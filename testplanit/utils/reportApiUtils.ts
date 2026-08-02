import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { isValidReportBypass } from "~/lib/internalReportBypass";
import { reportRequestSchema } from "~/lib/schemas/reportRequestSchema";
import { authOptions } from "~/server/auth";

// Type for Prisma client
type Prisma = typeof baseDb;

// Filters passed through to a metric's aggregate. Date bounds plus
// per-dimension options (folder subtree roll-up) carried like dateGrouping.
interface DateFilters {
  startDate?: string;
  endDate?: string;
  folderIncludeDescendants?: boolean;
}

// Dimension value display result
// Date dimensions return { executedAt: string } or { createdAt: string }
// Other dimensions return { name: string, id: number | string | null, ... }
interface DimensionDisplayValue {
  name?: string;
  id?: number | string | null;
  executedAt?: string | null;
  createdAt?: string | null;
  [key: string]: unknown; // Allow additional properties like color, etc.
}

// Dimension configuration interface
interface DimensionConfig {
  id: string;
  label: string;
  getValues: (baseDb: Prisma, projectId?: number) => Promise<unknown[]>;
  groupBy: string;
  join: Record<string, unknown>;
  display: (val: unknown) => DimensionDisplayValue;
  /**
   * Optional dedicated lookup for the per-dimension value-filter picker,
   * with DB-side search and pagination. Used when the picker's options
   * should differ from the raw group values (e.g. the test-execution
   * testCase dimension groups by run-case instance but users pick
   * repository cases).
   */
  filterValues?: (
    baseDb: Prisma,
    projectId: number | undefined,
    opts: { search?: string; ids?: string[]; skip: number; take: number }
  ) => Promise<{ results: DimensionDisplayValue[]; total: number }>;
  /**
   * Translates picked filter-value ids into the dimension's group keys
   * before rows are filtered (e.g. repository case ids -> run-case ids).
   */
  mapFilterValuesToGroupKeys?: (
    baseDb: Prisma,
    projectId: number | undefined,
    selected: Array<string | number>
  ) => Promise<Array<string | number>>;
}

// Metric configuration interface
interface MetricConfig {
  id: string;
  label: string;
  aggregate: (
    baseDb: Prisma,
    projectId: number | undefined,
    groupBy: string[],
    filters?: DateFilters,
    dims?: string[]
  ) => Promise<Record<string, unknown>[] | unknown[]>;
  hidden?: boolean;
}

// Report row type - dynamic object with dimension and metric values
type ReportRow = Record<string, unknown>;

// Registry types
type DimensionRegistry = Record<string, DimensionConfig | undefined>;
type MetricRegistry = Record<string, MetricConfig>;

// Report configuration interface
interface ReportConfig {
  reportType: string;
  requiresProjectId: boolean;
  requiresAdmin?: boolean;
  createDimensionRegistry: (isProjectSpecific: boolean) => DimensionRegistry;
  createMetricRegistry: (isProjectSpecific: boolean) => MetricRegistry;
}

/**
 * Authorization for every report endpoint (shared handlers, custom report
 * routes, drill-down). Order of precedence:
 * 1. A valid internal share-replay token (x-shared-report-bypass) — the
 *    share route has already validated the shareKey, so no user auth.
 * 2. Session or API-token auth. Admin-only (cross-project) surfaces require
 *    ADMIN; project-scoped surfaces require the caller to be able to read
 *    the project (checked through the policy-enhanced client, so it follows
 *    the same access rules as the rest of the app).
 */
export async function authorizeReportRequest(
  req: NextRequest,
  opts: { requiresAdmin: boolean; projectId?: number }
): Promise<{ ok: true; bypass: boolean } | { ok: false; response: Response }> {
  if (isValidReportBypass(req.headers.get("x-shared-report-bypass"))) {
    return { ok: true, bypass: true };
  }

  const session = await getServerSession(authOptions);
  const auth = await authenticateRequest(req, session);
  if (!auth.authenticated) {
    return {
      ok: false,
      response: Response.json({ error: auth.error }, { status: auth.status }),
    };
  }

  if (opts.requiresAdmin) {
    if (auth.user.access !== "ADMIN") {
      return {
        ok: false,
        response: Response.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    return { ok: true, bypass: false };
  }

  if (opts.projectId && auth.user.access !== "ADMIN") {
    const enhanced = await getEnhancedDb({
      user: { id: auth.user.userId },
    } as any);
    const project = await enhanced.projects.findFirst({
      where: { id: Number(opts.projectId) },
      select: { id: true },
    });
    if (!project) {
      return {
        ok: false,
        response: Response.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
  }

  return { ok: true, bypass: false };
}

// Helper: cartesian product
export function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce(
    (a: T[][], b: T[]) => a.flatMap((d: T[]) => b.map((e: T) => [...d, e])),
    [[]]
  );
}

/**
 * Drops aggregated rows whose group key for a filtered dimension is not in
 * that dimension's selected-value list. Because report rows are grouped BY
 * the selected dimensions, filtering on group keys after aggregation is
 * equivalent to filtering the underlying records first — each group either
 * matches wholly or not at all, so averages and sums are unaffected.
 *
 * `dimensionFilters` maps dimension id -> selected group-key ids. Dimension
 * ids not present in `dimensionConfigs` are ignored; a present-but-empty
 * list matches nothing (empty *selections* are stripped before this point —
 * see resolveDimensionFilterGroupKeys). Date group keys are normalized to
 * UTC-midnight ISO strings before comparison.
 */
export function filterRowsByDimensionValues(
  rows: Record<string, unknown>[],
  dimensionConfigs: DimensionConfig[],
  dimensionFilters?: Record<string, Array<string | number>>
): Record<string, unknown>[] {
  if (!dimensionFilters) return rows;

  const activeFilters = dimensionConfigs
    .map((config) => {
      const selected = dimensionFilters[config.id];
      if (!selected) return null;
      return {
        groupBy: config.groupBy,
        values: new Set(selected.map((v) => String(v))),
      };
    })
    .filter((f): f is { groupBy: string; values: Set<string> } => f !== null);

  if (activeFilters.length === 0) return rows;

  const normalizeKey = (groupBy: string, value: unknown): string => {
    if (value === null || value === undefined) return "null";
    if (groupBy === "executedAt" || groupBy === "createdAt") {
      const date = new Date(value as string);
      date.setUTCHours(0, 0, 0, 0);
      return date.toISOString();
    }
    return String(value);
  };

  return rows.filter((row) =>
    activeFilters.every((filter) =>
      filter.values.has(normalizeKey(filter.groupBy, row[filter.groupBy]))
    )
  );
}

/**
 * Translates picked filter-value ids into group keys for dimensions whose
 * picker options differ from their group values (mapFilterValuesToGroupKeys).
 * Other dimensions pass through unchanged. An empty translation result is
 * kept — it means "the selection matches nothing", not "no filter".
 */
async function resolveDimensionFilterGroupKeys(
  dimensionConfigs: DimensionConfig[],
  dimensionFilters: Record<string, Array<string | number>> | undefined,
  projectId: number | undefined
): Promise<Record<string, Array<string | number>> | undefined> {
  if (!dimensionFilters) return undefined;

  const resolved: Record<string, Array<string | number>> = {};
  for (const [dimId, selected] of Object.entries(dimensionFilters)) {
    if (!selected || selected.length === 0) continue;
    const config = dimensionConfigs.find((c) => c.id === dimId);
    if (!config) continue;
    resolved[dimId] = config.mapFilterValuesToGroupKeys
      ? await config.mapFilterValuesToGroupKeys(baseDb, projectId, selected)
      : selected;
  }
  return resolved;
}

export async function handleReportGET(req: NextRequest, config: ReportConfig) {
  try {
    const { searchParams } = new URL(req.url);
    const projectIdParam = searchParams.get("projectId");
    const projectId = projectIdParam ? Number(projectIdParam) : undefined;

    const authz = await authorizeReportRequest(req, {
      requiresAdmin: !!config.requiresAdmin,
      projectId,
    });
    if (!authz.ok) return authz.response;

    // Check project ID requirement
    if (config.requiresProjectId && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Get dimensions and metrics using provided factories
    const dimensionRegistry = config.createDimensionRegistry(
      !config.requiresAdmin
    );
    const metricRegistry = config.createMetricRegistry(!config.requiresAdmin);

    // Value-lookup mode: with ?dimensionId=… return that dimension's values,
    // searched and paginated, for the per-dimension filter pickers.
    const dimensionId = searchParams.get("dimensionId");
    if (dimensionId) {
      const dimension = dimensionRegistry[dimensionId];
      if (!dimension) {
        return Response.json(
          { error: `Unsupported dimension: ${dimensionId}` },
          { status: 400 }
        );
      }

      const search = (searchParams.get("search") ?? "").trim().toLowerCase();
      // Exact-id lookup, used to restore filter labels from URL-stored ids
      const idsParam = searchParams.get("ids");
      const ids = idsParam
        ? idsParam
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined;
      const pageParam = Number(searchParams.get("page") ?? 0);
      const valuesPage = Number.isFinite(pageParam)
        ? Math.max(0, pageParam)
        : 0;
      const pageSizeParam = Number(searchParams.get("pageSize") ?? 25);
      const valuesPageSize = Number.isFinite(pageSizeParam)
        ? Math.min(Math.max(1, pageSizeParam), 10000)
        : 25;

      // Dimensions with a dedicated filter-value lookup search and paginate
      // in the database instead of materializing every group value.
      if (dimension.filterValues) {
        const lookup = await dimension.filterValues(baseDb, projectId, {
          search: search || undefined,
          ids,
          skip: valuesPage * valuesPageSize,
          take: valuesPageSize,
        });
        return Response.json(lookup);
      }

      const rawValues = await dimension.getValues(baseDb, projectId);
      const displayValues = (rawValues as unknown[]).map((value) => {
        const display = dimension.display(value);
        // Value ids key the filter; date-style dimensions have no id and are
        // excluded from the pickers, but fall back to the date string.
        const id =
          display.id ?? display.executedAt ?? display.createdAt ?? null;
        const name =
          display.name ??
          (typeof display.executedAt === "string"
            ? display.executedAt
            : typeof display.createdAt === "string"
              ? display.createdAt
              : String(id));
        return { ...display, id, name };
      });

      const idSet = ids ? new Set(ids) : null;
      const idFiltered = idSet
        ? displayValues.filter((v) => idSet.has(String(v.id)))
        : displayValues;
      const filtered = search
        ? idFiltered.filter((v) =>
            String(v.name).toLowerCase().includes(search)
          )
        : idFiltered;

      return Response.json({
        results: filtered.slice(
          valuesPage * valuesPageSize,
          (valuesPage + 1) * valuesPageSize
        ),
        total: filtered.length,
      });
    }

    // Filter out undefined entries
    const validDimensions = Object.values(dimensionRegistry).filter(
      (dim): dim is DimensionConfig => dim !== undefined
    );
    const validMetrics = Object.values(metricRegistry) as MetricConfig[];

    // Don't fetch dimension values on GET - only return metadata
    // Values will be fetched as needed when the report is run (POST)
    const dimensions = validDimensions.map((dim: DimensionConfig) => ({
      id: dim.id,
      label: dim.label,
      // Don't include values on initial metadata fetch to avoid expensive queries
    }));

    const metrics = validMetrics
      .filter((metric: MetricConfig) => !metric.hidden) // Filter out hidden metrics
      .map((metric: MetricConfig) => ({
        id: metric.id,
        label: metric.label,
      }));

    return Response.json({ dimensions, metrics });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}

export async function handleReportPOST(req: NextRequest, config: ReportConfig) {
  try {
    const body = await req.json();

    const authz = await authorizeReportRequest(req, {
      requiresAdmin: !!config.requiresAdmin,
      projectId: body?.projectId ? Number(body.projectId) : undefined,
    });
    if (!authz.ok) return authz.response;
    const {
      projectId,
      dimensions,
      metrics,
      startDate,
      endDate,
      folderIncludeDescendants,
      dimensionFilters,
      page = 1,
      pageSize,
      sortColumn,
      sortDirection,
    } = body;

    // Validate with Zod schema
    const validation = reportRequestSchema.safeParse({
      ...body,
      reportType: config.reportType,
    });

    if (!validation.success) {
      return Response.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    // Check project ID requirement
    if (config.requiresProjectId && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const dims: string[] = dimensions || [];
    const mets: string[] = metrics || [];

    // Get registries
    const dimensionRegistry = config.createDimensionRegistry(
      !config.requiresAdmin
    );
    const metricRegistry = config.createMetricRegistry(!config.requiresAdmin);

    // Filter out undefined entries
    const validDimensionRegistry = Object.fromEntries(
      Object.entries(dimensionRegistry).filter(
        ([, value]) => value !== undefined
      )
    );
    const validMetricRegistry = metricRegistry;

    // Validate dimensions
    for (const d of dims) {
      if (!validDimensionRegistry[d]) {
        return Response.json(
          { error: `Unsupported dimension: ${d}` },
          { status: 400 }
        );
      }
    }

    // Validate metrics
    for (const m of mets) {
      if (!(m in validMetricRegistry)) {
        return Response.json(
          { error: `Unsupported metric: ${m}` },
          { status: 400 }
        );
      }
    }

    if (dims.length === 0 || mets.length === 0) {
      return Response.json(
        { error: "At least one dimension and one metric required" },
        { status: 400 }
      );
    }

    // For cross-project reports, use simplified aggregation
    if (config.requiresAdmin) {
      return handleCrossProjectAggregation({
        dimensions: dims,
        metrics: mets,
        dimensionRegistry: validDimensionRegistry,
        metricRegistry: validMetricRegistry,
        startDate,
        endDate,
        folderIncludeDescendants,
        dimensionFilters,
        page,
        pageSize,
        sortColumn,
        sortDirection,
      });
    }

    // For project-specific reports, use cartesian product approach
    return handleProjectSpecificAggregation({
      projectId,
      dimensions: dims,
      metrics: mets,
      dimensionRegistry: validDimensionRegistry,
      metricRegistry: validMetricRegistry,
      startDate,
      endDate,
      folderIncludeDescendants,
      dimensionFilters,
      page,
      pageSize,
      sortColumn,
      sortDirection,
    });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}

async function handleCrossProjectAggregation({
  dimensions,
  metrics,
  dimensionRegistry,
  metricRegistry,
  startDate,
  endDate,
  folderIncludeDescendants,
  dimensionFilters,
  page = 1,
  pageSize,
  sortColumn,
  sortDirection,
}: {
  dimensions: string[];
  metrics: string[];
  dimensionRegistry: DimensionRegistry;
  metricRegistry: MetricRegistry;
  startDate?: string;
  endDate?: string;
  folderIncludeDescendants?: boolean;
  dimensionFilters?: Record<string, Array<string | number>>;
  page?: number;
  pageSize?: number | "All";
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
}) {
  // Get dimension configurations
  const dimensionConfigs: DimensionConfig[] = dimensions
    .map((dimId: string) => dimensionRegistry[dimId])
    .filter((config): config is DimensionConfig => config !== undefined);

  const metricConfigs: MetricConfig[] = metrics
    .map((metricId: string) => {
      const config = Object.values(metricRegistry).find(
        (metric: MetricConfig) => metric.id === metricId
      ) as MetricConfig | undefined;
      return config;
    })
    .filter((config): config is MetricConfig => config !== undefined);

  // Get group by fields
  const groupBy = dimensionConfigs.map(
    (config: DimensionConfig) => config.groupBy
  );

  // Aggregate all metrics using the same groupBy
  const rawMetricResults = await Promise.all(
    metricConfigs.map((metricConfig: MetricConfig) =>
      metricConfig.aggregate(
        baseDb,
        undefined, // No projectId for cross-project
        groupBy,
        { startDate, endDate, folderIncludeDescendants },
        dimensions
      )
    )
  );

  // Apply per-dimension value filters on the group keys
  const resolvedDimensionFilters = await resolveDimensionFilterGroupKeys(
    dimensionConfigs,
    dimensionFilters,
    undefined
  );
  const metricResults = rawMetricResults.map((rows) =>
    filterRowsByDimensionValues(
      rows as Record<string, unknown>[],
      dimensionConfigs,
      resolvedDimensionFilters
    )
  );

  // Get all dimension values lookup for display formatting
  const dimensionValues = await Promise.all(
    dimensionConfigs.map(
      (config: DimensionConfig) => config.getValues(baseDb) // No projectId for cross-project
    )
  );

  // Create lookup maps for dimension values (CROSS-PROJECT)
  const dimensionLookups = dimensionConfigs.map(
    (config: DimensionConfig, index: number) => {
      const values = dimensionValues[index];
      const lookup = new Map<string, unknown>();
      (values as unknown[]).forEach((value: unknown) => {
        const valueObj = value as Record<string, unknown>;
        // For dimensions ending in "Id", use the id as key
        // For other dimensions, try to use the groupBy field, then name, then id as fallback
        const key = config.groupBy.endsWith("Id")
          ? valueObj.id
          : valueObj[config.groupBy] || valueObj.name || valueObj.id;
        // Ensure consistent types for lookups (convert to string)
        lookup.set(String(key), value);
      });
      return lookup;
    }
  );

  // Merge results from all metrics based on matching keys
  const resultMap = new Map<string, ReportRow>();

  // Process each metric's results
  metricResults.forEach((currentMetricResults, metricIndex) => {
    const metricConfig = metricConfigs[metricIndex];
    // Type assertion: metric results should be Record<string, unknown>[]
    const typedResults = currentMetricResults as Record<string, unknown>[];

    typedResults.forEach((result: Record<string, unknown>) => {
      // Create a key for this result
      const resultKey = dimensionConfigs
        .map((config: DimensionConfig) => {
          const resultObj = result as Record<string, unknown>;
          if (config.groupBy === "executedAt") {
            if (!resultObj.executedAt) {
              return "unknown";
            }
            const date = new Date(resultObj.executedAt as string);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          } else if (config.groupBy === "createdAt") {
            if (!resultObj.createdAt) {
              return "unknown";
            }
            const date = new Date(resultObj.createdAt as string);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          }
          return String(resultObj[config.groupBy] ?? "unknown");
        })
        .join("|");

      // Get or create the row for this key
      if (!resultMap.has(resultKey)) {
        const row: ReportRow = {};

        // Add dimension values with display formatting
        dimensionConfigs.forEach(
          (config: DimensionConfig, dimIndex: number) => {
            const resultObj = result as Record<string, unknown>;
            const dimValue = resultObj[config.groupBy];
            const lookup = dimensionLookups[dimIndex];

            if (config.groupBy === "executedAt") {
              // Special handling for date dimension
              if (!resultObj.executedAt) {
                row[config.id] = { executedAt: null, name: "None" };
              } else {
                const date = new Date(resultObj.executedAt as string);
                date.setUTCHours(0, 0, 0, 0);
                row[config.id] = { executedAt: date.toISOString() };
              }
            } else if (config.groupBy === "createdAt") {
              // Special handling for date dimension with createdAt
              if (!resultObj.createdAt) {
                row[config.id] = { createdAt: null, name: "None" };
              } else {
                const date = new Date(resultObj.createdAt as string);
                date.setUTCHours(0, 0, 0, 0);
                row[config.id] = { createdAt: date.toISOString() };
              }
            } else {
              const fullDimValue = lookup.get(String(dimValue));

              if (fullDimValue) {
                const displayValue = config.display(fullDimValue);
                row[config.id] = displayValue;
              } else if (dimValue === null || dimValue === undefined) {
                // Handle null/undefined values
                row[config.id] =
                  config.id === "status"
                    ? { name: "None", id: null, color: "#6b7280" }
                    : { name: "None", id: null };
              } else {
                // Handle status dimension specially - check if status data is in result
                if (config.id === "status" && resultObj.status) {
                  const displayValue = config.display(resultObj.status);
                  row[config.id] = displayValue;
                } else {
                  // Handle other unknown values
                  row[config.id] = { name: "Unknown", id: dimValue };
                }
              }
            }
          }
        );

        // Initialize all metric values to 0 for this new row
        // This ensures every row has all metrics, even if some metrics don't have results for this row
        metricConfigs.forEach((mc: MetricConfig) => {
          row[mc.label] = 0;
        });

        resultMap.set(resultKey, row);
      }

      // Add the metric value to the row
      const row = resultMap.get(resultKey);
      if (row && metricConfig) {
        row[metricConfig.label] = result[metricConfig.id];
      }
    });
  });

  // If no dimensions specified and no results found, return default zero values
  if (dimensions.length === 0 && resultMap.size === 0) {
    const defaultResult: ReportRow = {};
    metricConfigs.forEach((metricConfig: MetricConfig) => {
      defaultResult[metricConfig.label] = 0;
    });
    return Response.json({ results: [defaultResult] });
  }

  // Convert result map to array
  const results = Array.from(resultMap.values());

  // Apply sorting if specified
  if (sortColumn && sortDirection) {
    results.sort((a: ReportRow, b: ReportRow) => {
      // Determine if sortColumn is a dimension or metric
      let aVal, bVal;

      // Check if it's a dimension
      if (dimensions.includes(sortColumn)) {
        const _dimData = a[sortColumn];
        const _dimDataB = b[sortColumn];

        // Handle different dimension types
        if (sortColumn === "date") {
          // Try both executedAt and createdAt fields
          const dateA = a[sortColumn] as DimensionDisplayValue | undefined;
          const dateB = b[sortColumn] as DimensionDisplayValue | undefined;
          aVal = dateA?.executedAt || dateA?.createdAt;
          bVal = dateB?.executedAt || dateB?.createdAt;
        } else {
          // For other dimensions, sort by name or id
          const dimA = a[sortColumn] as DimensionDisplayValue | undefined;
          const dimB = b[sortColumn] as DimensionDisplayValue | undefined;
          aVal = dimA?.name || dimA?.id;
          bVal = dimB?.name || dimB?.id;
        }
      } else {
        // It's a metric - need to find the metric config by matching the backend ID
        // The sortColumn is a backend metric ID (e.g., 'testResultCount')
        // The metricConfigs have the label that's used as the key in the result object

        // Try to find the metric config that matches the sortColumn
        // This could be by id or by checking if the config represents this metric
        const metricConfig = metricConfigs.find((mc: MetricConfig) => {
          // Some metrics have different frontend IDs but backend labels
          // Map common cases:
          if (sortColumn === "testResultCount" && mc.id === "testResults")
            return true;
          if (sortColumn === "testRunCount" && mc.id === "testRunCount")
            return true;
          if (sortColumn === "testCaseCount" && mc.id === "testCaseCount")
            return true;
          if (sortColumn === "passRate" && mc.id === "passRate") return true;
          if (sortColumn === "avgElapsed" && mc.id === "avgElapsedTime")
            return true;
          if (sortColumn === "sumElapsed" && mc.id === "totalElapsedTime")
            return true;

          // Also try direct ID match as fallback
          return mc.id === sortColumn;
        });

        if (metricConfig) {
          const metricLabel = metricConfig.label;
          aVal = a[metricLabel];
          bVal = b[metricLabel];
        } else {
          // Fallback: use the sortColumn directly as the key
          aVal = a[sortColumn];
          bVal = b[sortColumn];
        }
      }

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      const multiplier = sortDirection === "asc" ? 1 : -1;

      // Handle dates
      if (
        sortColumn === "date" ||
        aVal instanceof Date ||
        bVal instanceof Date
      ) {
        const aTime = new Date(aVal as string | number | Date).getTime();
        const bTime = new Date(bVal as string | number | Date).getTime();
        return (aTime - bTime) * multiplier;
      }

      // Handle numbers
      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * multiplier;
      }

      // Handle strings
      return String(aVal).localeCompare(String(bVal)) * multiplier;
    });
  } else if (dimensions.includes("date")) {
    // Default sort by date if date dimension is used (for backward compatibility)
    results.sort((a: ReportRow, b: ReportRow) => {
      // Try both executedAt and createdAt fields since different reports use different date fields
      const dateA = a.date as DimensionDisplayValue | undefined;
      const dateB = b.date as DimensionDisplayValue | undefined;
      const dateAValue = dateA?.executedAt || dateA?.createdAt;
      const dateBValue = dateB?.executedAt || dateB?.createdAt;

      if (!dateAValue && !dateBValue) return 0;
      if (!dateAValue) return 1;
      if (!dateBValue) return -1;

      return (
        new Date(dateAValue as string).getTime() -
        new Date(dateBValue as string).getTime()
      );
    });
  }

  // Apply pagination
  const totalCount = results.length;
  let paginatedResults = results;

  if (pageSize && pageSize !== "All") {
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    paginatedResults = results.slice(skip, skip + take);
  }

  return Response.json({
    results: paginatedResults,
    allResults: results, // Full dataset for charts
    totalCount,
    page,
    pageSize: pageSize || totalCount,
  });
}

async function handleProjectSpecificAggregation({
  projectId,
  dimensions,
  metrics,
  dimensionRegistry,
  metricRegistry,
  startDate,
  endDate,
  folderIncludeDescendants,
  dimensionFilters,
  page = 1,
  pageSize,
  sortColumn,
  sortDirection,
}: {
  projectId: number;
  dimensions: string[];
  metrics: string[];
  dimensionRegistry: DimensionRegistry;
  metricRegistry: MetricRegistry;
  startDate?: string;
  endDate?: string;
  folderIncludeDescendants?: boolean;
  dimensionFilters?: Record<string, Array<string | number>>;
  page?: number;
  pageSize?: number | "All";
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
}) {
  // Get dimension configurations
  const dimensionConfigs: DimensionConfig[] = dimensions
    .map((dimId: string) => dimensionRegistry[dimId])
    .filter((config): config is DimensionConfig => config !== undefined);

  const metricConfigs: MetricConfig[] = metrics
    .map((metricId: string) => {
      const config = Object.values(metricRegistry).find(
        (metric: MetricConfig) => metric.id === metricId
      ) as MetricConfig | undefined;
      return config;
    })
    .filter((config): config is MetricConfig => config !== undefined);

  // Get group by fields
  const groupBy = dimensionConfigs.map(
    (config: DimensionConfig) => config.groupBy
  );

  // Aggregate all metrics using the same groupBy
  const rawMetricResults = await Promise.all(
    metricConfigs.map((metricConfig: MetricConfig) =>
      metricConfig.aggregate(
        baseDb,
        projectId,
        groupBy,
        { startDate, endDate, folderIncludeDescendants },
        dimensions
      )
    )
  );

  // Apply per-dimension value filters on the group keys
  const resolvedDimensionFilters = await resolveDimensionFilterGroupKeys(
    dimensionConfigs,
    dimensionFilters,
    projectId
  );
  const metricResults = rawMetricResults.map((rows) =>
    filterRowsByDimensionValues(
      rows as Record<string, unknown>[],
      dimensionConfigs,
      resolvedDimensionFilters
    )
  );

  // Get all dimension values lookup for display formatting
  const dimensionValues = await Promise.all(
    dimensionConfigs.map((config: DimensionConfig) =>
      config.getValues(baseDb, projectId)
    )
  );

  // Create lookup maps for dimension values (PROJECT-SPECIFIC)
  const dimensionLookups = dimensionConfigs.map(
    (config: DimensionConfig, index: number) => {
      const values = dimensionValues[index];
      const lookup = new Map<string, unknown>();
      (values as unknown[]).forEach((value: unknown) => {
        const valueObj = value as Record<string, unknown>;
        // For dimensions ending in "Id", use the id as key
        // For other dimensions, try to use the groupBy field, then name, then id as fallback
        const key = config.groupBy.endsWith("Id")
          ? valueObj.id
          : valueObj[config.groupBy] || valueObj.name || valueObj.id;
        // Ensure consistent types for lookups (convert to string)
        lookup.set(String(key), value);
      });
      return lookup;
    }
  );

  // Merge results from all metrics based on matching keys
  const resultMap = new Map<string, ReportRow>();

  // Process each metric's results
  metricResults.forEach((currentMetricResults, metricIndex) => {
    const metricConfig = metricConfigs[metricIndex];
    // Type assertion: metric results should be Record<string, unknown>[]
    const typedResults = currentMetricResults as Record<string, unknown>[];

    typedResults.forEach((result: Record<string, unknown>) => {
      // Create a key for this result
      const resultKey = dimensionConfigs
        .map((config: DimensionConfig) => {
          const resultObj = result as Record<string, unknown>;
          if (config.groupBy === "executedAt") {
            if (!resultObj.executedAt) {
              return "unknown";
            }
            const date = new Date(resultObj.executedAt as string);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          } else if (config.groupBy === "createdAt") {
            if (!resultObj.createdAt) {
              return "unknown";
            }
            const date = new Date(resultObj.createdAt as string);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          }
          return String(resultObj[config.groupBy] ?? "unknown");
        })
        .join("|");

      // Get or create the row for this key
      if (!resultMap.has(resultKey)) {
        const row: ReportRow = {};

        // Add dimension values with display formatting
        dimensionConfigs.forEach(
          (config: DimensionConfig, dimIndex: number) => {
            const resultObj = result as Record<string, unknown>;
            const dimValue = resultObj[config.groupBy];
            const lookup = dimensionLookups[dimIndex];

            if (config.groupBy === "executedAt") {
              // Special handling for date dimension
              if (!resultObj.executedAt) {
                row[config.id] = { executedAt: null, name: "None" };
              } else {
                const date = new Date(resultObj.executedAt as string);
                date.setUTCHours(0, 0, 0, 0);
                row[config.id] = { executedAt: date.toISOString() };
              }
            } else if (config.groupBy === "createdAt") {
              // Special handling for date dimension with createdAt
              if (!resultObj.createdAt) {
                row[config.id] = { createdAt: null, name: "None" };
              } else {
                const date = new Date(resultObj.createdAt as string);
                date.setUTCHours(0, 0, 0, 0);
                row[config.id] = { createdAt: date.toISOString() };
              }
            } else {
              const fullDimValue = lookup.get(String(dimValue));

              if (fullDimValue) {
                const displayValue = config.display(fullDimValue);
                row[config.id] = displayValue;
              } else if (dimValue === null || dimValue === undefined) {
                // Handle null/undefined values
                row[config.id] =
                  config.id === "status"
                    ? { name: "None", id: null, color: "#6b7280" }
                    : { name: "None", id: null };
              } else {
                // Handle status dimension specially - check if status data is in result
                if (config.id === "status" && resultObj.status) {
                  const displayValue = config.display(resultObj.status);
                  row[config.id] = displayValue;
                } else {
                  // Handle other unknown values
                  row[config.id] = { name: "Unknown", id: dimValue };
                }
              }
            }
          }
        );

        // Initialize all metric values to 0 for this new row
        // This ensures every row has all metrics, even if some metrics don't have results for this row
        metricConfigs.forEach((mc: MetricConfig) => {
          row[mc.label] = 0;
        });

        resultMap.set(resultKey, row);
      }

      // Add the metric value to the row
      const row = resultMap.get(resultKey);
      if (row && metricConfig) {
        row[metricConfig.label] = result[metricConfig.id];
      }
    });
  });

  // If no dimensions specified and no results found, return default zero values
  if (dimensions.length === 0 && resultMap.size === 0) {
    const defaultResult: ReportRow = {};
    metricConfigs.forEach((metricConfig: MetricConfig) => {
      defaultResult[metricConfig.label] = 0;
    });
    return Response.json({ results: [defaultResult] });
  }

  // Convert result map to array
  const results = Array.from(resultMap.values());

  // Apply sorting if specified
  if (sortColumn && sortDirection) {
    results.sort((a: ReportRow, b: ReportRow) => {
      // Determine if sortColumn is a dimension or metric
      let aVal, bVal;

      // Check if it's a dimension
      if (dimensions.includes(sortColumn)) {
        const _dimData = a[sortColumn];
        const _dimDataB = b[sortColumn];

        // Handle different dimension types
        if (sortColumn === "date") {
          // Try both executedAt and createdAt fields
          const dateA = a[sortColumn] as DimensionDisplayValue | undefined;
          const dateB = b[sortColumn] as DimensionDisplayValue | undefined;
          aVal = dateA?.executedAt || dateA?.createdAt;
          bVal = dateB?.executedAt || dateB?.createdAt;
        } else {
          // For other dimensions, sort by name or id
          const dimA = a[sortColumn] as DimensionDisplayValue | undefined;
          const dimB = b[sortColumn] as DimensionDisplayValue | undefined;
          aVal = dimA?.name || dimA?.id;
          bVal = dimB?.name || dimB?.id;
        }
      } else {
        // It's a metric - need to find the metric config by matching the backend ID
        // The sortColumn is a backend metric ID (e.g., 'testResultCount')
        // The metricConfigs have the label that's used as the key in the result object

        // Try to find the metric config that matches the sortColumn
        // This could be by id or by checking if the config represents this metric
        const metricConfig = metricConfigs.find((mc: MetricConfig) => {
          // Some metrics have different frontend IDs but backend labels
          // Map common cases:
          if (sortColumn === "testResultCount" && mc.id === "testResults")
            return true;
          if (sortColumn === "testRunCount" && mc.id === "testRunCount")
            return true;
          if (sortColumn === "testCaseCount" && mc.id === "testCaseCount")
            return true;
          if (sortColumn === "passRate" && mc.id === "passRate") return true;
          if (sortColumn === "avgElapsed" && mc.id === "avgElapsedTime")
            return true;
          if (sortColumn === "sumElapsed" && mc.id === "totalElapsedTime")
            return true;

          // Also try direct ID match as fallback
          return mc.id === sortColumn;
        });

        if (metricConfig) {
          const metricLabel = metricConfig.label;
          aVal = a[metricLabel];
          bVal = b[metricLabel];
        } else {
          // Fallback: use the sortColumn directly as the key
          aVal = a[sortColumn];
          bVal = b[sortColumn];
        }
      }

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      const multiplier = sortDirection === "asc" ? 1 : -1;

      // Handle dates
      if (
        sortColumn === "date" ||
        aVal instanceof Date ||
        bVal instanceof Date
      ) {
        const aTime = new Date(aVal as string | number | Date).getTime();
        const bTime = new Date(bVal as string | number | Date).getTime();
        return (aTime - bTime) * multiplier;
      }

      // Handle numbers with stable secondary sort by date
      if (typeof aVal === "number" && typeof bVal === "number") {
        const numComparison = (aVal - bVal) * multiplier;

        // If values are equal, use date as secondary sort for stable sorting
        if (
          numComparison === 0 &&
          dimensions.includes("date") &&
          sortColumn !== "date"
        ) {
          const dateA = a.date as DimensionDisplayValue | undefined;
          const dateB = b.date as DimensionDisplayValue | undefined;
          const dateAValue = dateA?.executedAt || dateA?.createdAt;
          const dateBValue = dateB?.executedAt || dateB?.createdAt;

          if (dateAValue && dateBValue) {
            return (
              new Date(dateAValue as string).getTime() -
              new Date(dateBValue as string).getTime()
            );
          }
        }

        return numComparison;
      }

      // Handle strings
      const stringComparison =
        String(aVal).localeCompare(String(bVal)) * multiplier;

      // If values are equal, use date as secondary sort for stable sorting
      if (
        stringComparison === 0 &&
        dimensions.includes("date") &&
        sortColumn !== "date"
      ) {
        const dateA = a.date as DimensionDisplayValue | undefined;
        const dateB = b.date as DimensionDisplayValue | undefined;
        const dateAValue = dateA?.executedAt || dateA?.createdAt;
        const dateBValue = dateB?.executedAt || dateB?.createdAt;

        if (dateAValue && dateBValue) {
          return (
            new Date(dateAValue as string).getTime() -
            new Date(dateBValue as string).getTime()
          );
        }
      }

      return stringComparison;
    });
  } else if (dimensions.includes("date") && !(sortColumn && sortDirection)) {
    // Default sort by date if date dimension is used (for backward compatibility)
    results.sort((a: ReportRow, b: ReportRow) => {
      // Try both executedAt and createdAt fields since different reports use different date fields
      const dateA = a.date as DimensionDisplayValue | undefined;
      const dateB = b.date as DimensionDisplayValue | undefined;
      const dateAValue = dateA?.executedAt || dateA?.createdAt;
      const dateBValue = dateB?.executedAt || dateB?.createdAt;

      if (!dateAValue && !dateBValue) return 0;
      if (!dateAValue) return 1;
      if (!dateBValue) return -1;

      return (
        new Date(dateAValue as string).getTime() -
        new Date(dateBValue as string).getTime()
      );
    });
  }

  // Apply pagination
  const totalCount = results.length;
  let paginatedResults = results;

  if (pageSize && pageSize !== "All") {
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    paginatedResults = results.slice(skip, skip + take);
  }

  return Response.json({
    results: paginatedResults,
    allResults: results, // Full dataset for charts
    totalCount,
    page,
    pageSize: pageSize || totalCount,
  });
}
