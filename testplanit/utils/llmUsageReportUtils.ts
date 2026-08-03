import { buildDateFilter } from "~/utils/resultUnion";

/**
 * Dimension and metric registries for the LLM Usage report
 * (cross-project-llm-usage). Aggregates the LlmUsage table: one row per LLM
 * call with token counts, cost, latency, and success, keyed by feature,
 * model, user, project, and integration.
 *
 * projectId and llmIntegrationId are nullable on LlmUsage (admin-console
 * calls have no project), so rows with a null group key surface as "None"
 * rather than being dropped — a cost report must account for all spend.
 */

// Every groupBy a dimension below can request is a scalar column on
// LlmUsage, so metrics read group keys straight off the fetched rows.
const GROUPABLE_COLUMNS = new Set([
  "feature",
  "model",
  "userId",
  "projectId",
  "llmIntegrationId",
  "success",
  "createdAt",
]);

// "test_case_generation" -> "Test Case Generation"
function featureDisplayName(feature: string): string {
  return feature
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function dayIso(value: Date | string): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function projectScope(isProjectSpecific: boolean, projectId?: number) {
  return isProjectSpecific && projectId ? { projectId: Number(projectId) } : {};
}

type UsageRow = {
  feature: string;
  model: string;
  userId: string;
  projectId: number | null;
  llmIntegrationId: number | null;
  success: boolean;
  createdAt: Date;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCost: unknown; // Prisma Decimal
  latency: number;
};

/**
 * Fetches the usage rows once and buckets them by the requested group keys.
 * With an empty groupBy this yields a single overall bucket (the framework's
 * "totals" mode). createdAt group keys are normalized to UTC midnight to
 * match the shared report pipeline's date handling.
 */
async function aggregateUsage<B extends Record<string, unknown>>(
  db: any,
  projectId: number | undefined,
  isProjectSpecific: boolean,
  groupBy: string[],
  filters: { startDate?: string; endDate?: string } | undefined,
  init: () => B,
  accumulate: (bucket: B, row: UsageRow) => void
): Promise<Array<Record<string, unknown> & B>> {
  const groupFields = groupBy.filter((field) => GROUPABLE_COLUMNS.has(field));

  const rows: UsageRow[] = await db.llmUsage.findMany({
    where: {
      ...projectScope(isProjectSpecific, projectId),
      ...buildDateFilter(filters, "createdAt"),
    },
    select: {
      feature: true,
      model: true,
      userId: true,
      projectId: true,
      llmIntegrationId: true,
      success: true,
      createdAt: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      totalCost: true,
      latency: true,
    },
  });

  const grouped = new Map<string, Record<string, unknown> & B>();
  for (const row of rows) {
    const key = groupFields
      .map((field) =>
        field === "createdAt"
          ? dayIso(row.createdAt)
          : String(row[field as keyof UsageRow] ?? "null")
      )
      .join("|");

    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = { ...init() } as Record<string, unknown> & B;
      const groupKeys = bucket as Record<string, unknown>;
      for (const field of groupFields) {
        groupKeys[field] =
          field === "createdAt"
            ? dayIso(row.createdAt)
            : row[field as keyof UsageRow];
      }
      grouped.set(key, bucket);
    }
    accumulate(bucket, row);
  }

  return Array.from(grouped.values());
}

export function createLlmUsageDimensionRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    project: !isProjectSpecific
      ? {
          id: "project",
          label: "Project",
          getValues: async (db: any, _projectId?: number) => {
            return db.projects.findMany({
              where: { llmUsages: { some: {} } },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            });
          },
          groupBy: "projectId",
          join: { project: { select: { id: true, name: true } } },
          display: (val: any) => ({ name: val.name, id: val.id }),
        }
      : undefined,
    user: {
      id: "user",
      label: "User",
      // No isDeleted filter: spend by a since-removed user still belongs in
      // a cost report, and the lookup miss would otherwise render "Unknown".
      getValues: async (db: any, projectId?: number) => {
        return db.user.findMany({
          where: {
            llmUsages: { some: projectScope(isProjectSpecific, projectId) },
          },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        });
      },
      groupBy: "userId",
      join: { user: true },
      display: (val: any) => ({ name: val.name, id: val.id, email: val.email }),
    },
    feature: {
      id: "feature",
      label: "Feature",
      getValues: async (db: any, projectId?: number) => {
        const rows = await db.llmUsage.findMany({
          where: projectScope(isProjectSpecific, projectId),
          select: { feature: true },
          distinct: ["feature"],
          orderBy: { feature: "asc" },
        });
        return rows.map((r: any) => ({
          id: r.feature,
          name: featureDisplayName(r.feature),
          feature: r.feature,
        }));
      },
      groupBy: "feature",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    model: {
      id: "model",
      label: "Model",
      getValues: async (db: any, projectId?: number) => {
        const rows = await db.llmUsage.findMany({
          where: projectScope(isProjectSpecific, projectId),
          select: { model: true },
          distinct: ["model"],
          orderBy: { model: "asc" },
        });
        return rows.map((r: any) => ({
          id: r.model,
          name: r.model,
          model: r.model,
        }));
      },
      groupBy: "model",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    integration: {
      id: "integration",
      label: "Integration",
      getValues: async (db: any, projectId?: number) => {
        return db.llmIntegration.findMany({
          where: {
            llmUsages: { some: projectScope(isProjectSpecific, projectId) },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
      },
      groupBy: "llmIntegrationId",
      join: { llmIntegration: { select: { id: true, name: true } } },
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    outcome: {
      id: "outcome",
      label: "Outcome",
      // Group keys are String(row.success) — "true"/"false" — so the value
      // ids here must be those strings for lookups and filters to match.
      getValues: async () => [
        { id: "true", name: "Success", success: true },
        { id: "false", name: "Failed", success: false },
      ],
      groupBy: "success",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    date: {
      id: "date",
      label: "Date",
      getValues: async (db: any, projectId?: number) => {
        const rows = await db.llmUsage.findMany({
          where: projectScope(isProjectSpecific, projectId),
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
        });
        const days = new Map<string, { createdAt: string }>();
        rows.forEach((r: any) => {
          const iso = dayIso(r.createdAt);
          if (!days.has(iso)) {
            days.set(iso, { createdAt: iso });
          }
        });
        return Array.from(days.values());
      },
      groupBy: "createdAt",
      join: {},
      display: (val: any) => {
        if (!val || !val.createdAt) {
          return { createdAt: null };
        }
        return { createdAt: dayIso(val.createdAt) };
      },
    },
  };
}

export function createLlmUsageMetricRegistry(
  isProjectSpecific: boolean = true
) {
  const sumMetric = (
    id: string,
    read: (row: UsageRow) => number
  ): {
    id: string;
    aggregate: (
      db: any,
      projectId: number | undefined,
      groupBy: string[],
      filters?: any,
      dims?: string[]
    ) => Promise<Record<string, unknown>[]>;
  } => ({
    id,
    aggregate: async (
      db: any,
      projectId: number | undefined,
      groupBy: string[],
      filters?: any,
      _dims?: string[]
    ) => {
      return aggregateUsage(
        db,
        projectId,
        isProjectSpecific,
        groupBy,
        filters,
        () => ({ [id]: 0 }),
        (bucket, row) => {
          (bucket as any)[id] += read(row);
        }
      );
    },
  });

  return {
    llmCallCount: {
      label: "LLM Calls",
      ...sumMetric("llmCallCount", () => 1),
    },
    promptTokens: {
      label: "Prompt Tokens",
      ...sumMetric("promptTokens", (row) => row.promptTokens),
    },
    completionTokens: {
      label: "Completion Tokens",
      ...sumMetric("completionTokens", (row) => row.completionTokens),
    },
    totalTokens: {
      label: "Total Tokens",
      ...sumMetric("totalTokens", (row) => row.totalTokens),
    },
    totalCost: {
      id: "totalCost",
      label: "Total Cost",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        const buckets = await aggregateUsage(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters,
          () => ({ totalCost: 0 }),
          (bucket, row) => {
            bucket.totalCost += Number(row.totalCost);
          }
        );
        // Costs are Decimal(10,6) in the DB; round the float sum back to
        // that precision so cells don't show accumulation noise.
        return buckets.map((bucket) => ({
          ...bucket,
          totalCost: Math.round((bucket.totalCost as number) * 1e6) / 1e6,
        }));
      },
    },
    avgLatency: {
      id: "avgLatency",
      label: "Avg. Latency",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        const buckets = await aggregateUsage(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters,
          () => ({ latencyMs: 0, calls: 0 }),
          (bucket, row) => {
            bucket.latencyMs += row.latency;
            bucket.calls++;
          }
        );
        // Report durations are seconds end to end (utils/metricUnits.ts);
        // LlmUsage.latency is milliseconds.
        return buckets.map(({ latencyMs, calls, ...groupKeys }) => ({
          ...groupKeys,
          avgLatency: calls > 0 ? latencyMs / calls / 1000 : 0,
        }));
      },
    },
    successRate: {
      id: "successRate",
      label: "Success Rate (%)",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        const buckets = await aggregateUsage(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters,
          () => ({ succeeded: 0, calls: 0 }),
          (bucket, row) => {
            if (row.success) bucket.succeeded++;
            bucket.calls++;
          }
        );
        return buckets.map(({ succeeded, calls, ...groupKeys }) => ({
          ...groupKeys,
          successRate: calls > 0 ? (succeeded / calls) * 100 : null,
        }));
      },
    },
    errorCount: {
      label: "Failed Calls",
      ...sumMetric("errorCount", (row) => (row.success ? 0 : 1)),
    },
  };
}
