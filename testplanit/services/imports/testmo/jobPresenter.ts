import type {
  TestmoImportDataset,
  TestmoImportJob,
} from "@prisma/client";
import type {
  TestmoAnalysisSummaryPayload,
  TestmoDatasetSummaryPayload,
  TestmoImportJobPayload,
} from "./types";

function toNumber(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "bigint" ? Number(value) : value;
}

function toStringISO(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function normalizeJsonArray(value: unknown): unknown[] | null | undefined {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value as unknown[];
  }

  return undefined;
}

function normalizeJsonObject(
  value: unknown
): Record<string, unknown> | null | undefined {
  if (value === null) {
    return null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function buildDatasets(
  datasets?: TestmoImportDataset[]
): TestmoDatasetSummaryPayload[] {
  if (!datasets || datasets.length === 0) {
    return [];
  }

  return datasets.map((dataset) => ({
    id: dataset.id,
    name: dataset.name,
    rowCount: dataset.rowCount,
    sampleRowCount: dataset.sampleRowCount,
    truncated: dataset.truncated,
  }));
}

export function serializeImportJob(
  job: TestmoImportJob & { datasets?: TestmoImportDataset[] },
  options: { includeDatasets?: boolean } = {}
): TestmoImportJobPayload {
  const {
    includeDatasets = false,
  } = options;

  const datasets = includeDatasets ? buildDatasets(job.datasets) : undefined;

  const activityLog = normalizeJsonArray(job.activityLog);
  const entityProgress = normalizeJsonObject(job.entityProgress);
  const normalizedOptions = normalizeJsonObject(job.options);
  const configurationPayload = normalizeJsonObject(job.configuration);
  const analysisPayload = normalizeJsonObject(job.analysis);
  const analysisMeta =
    analysisPayload && typeof analysisPayload.meta === "object"
      ? (analysisPayload.meta as Record<string, unknown>)
      : null;

  let summary: TestmoAnalysisSummaryPayload | null = null;
  const hasSummaryData =
    job.totalDatasets !== null && job.totalDatasets !== undefined;

  if (job.status === "COMPLETED" || hasSummaryData) {
    const metaStartedAt =
      typeof analysisMeta?.startedAt === "string"
        ? analysisMeta.startedAt
        : toStringISO(job.startedAt) ?? new Date(0).toISOString();
    const metaCompletedAt =
      typeof analysisMeta?.completedAt === "string"
        ? analysisMeta.completedAt
        : toStringISO(job.completedAt) ?? new Date(0).toISOString();
    const metaDuration =
      typeof analysisMeta?.durationMs === "number"
        ? analysisMeta.durationMs
        : job.durationMs ?? 0;
    const metaFileSize =
      typeof analysisMeta?.fileSizeBytes === "number"
        ? analysisMeta.fileSizeBytes
        : toNumber(job.originalFileSize) ?? 0;
    const metaTotalRows =
      typeof analysisMeta?.totalRows === "number"
        ? analysisMeta.totalRows
        : toNumber(job.totalRows) ?? 0;
    const metaTotalDatasets =
      typeof analysisMeta?.totalDatasets === "number"
        ? analysisMeta.totalDatasets
        : job.totalDatasets ?? datasets?.length ?? 0;

    summary = {
      meta: {
        totalDatasets: metaTotalDatasets,
        totalRows: metaTotalRows,
        durationMs: metaDuration,
        startedAt: metaStartedAt,
        completedAt: metaCompletedAt,
        fileName: job.originalFileName,
        fileSizeBytes: metaFileSize,
      },
      datasets: datasets ?? [],
      storage: {
        key: job.storageKey,
        bucket: job.storageBucket ?? undefined,
      },
    };
  }

  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    phase: job.phase,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: toStringISO(job.startedAt),
    completedAt: toStringISO(job.completedAt),
    canceledAt: toStringISO(job.canceledAt),
    originalFileName: job.originalFileName,
    originalFileSize: toNumber(job.originalFileSize),
    storageKey: job.storageKey,
    storageBucket: job.storageBucket ?? undefined,
    totalDatasets: job.totalDatasets,
    processedDatasets: job.processedDatasets ?? undefined,
    totalRows: toNumber(job.totalRows),
    processedRows: toNumber(job.processedRows),
    durationMs: job.durationMs ?? undefined,
    error: job.error ?? undefined,
    cancelRequested: job.cancelRequested,
    summary,
    datasets,
    processedCount: job.processedCount ?? undefined,
    errorCount: job.errorCount ?? undefined,
    skippedCount: job.skippedCount ?? undefined,
    totalCount: job.totalCount ?? undefined,
    currentEntity: job.currentEntity ?? undefined,
    estimatedTimeRemaining: job.estimatedTimeRemaining ?? undefined,
    processingRate: job.processingRate ?? undefined,
    activityLog,
    entityProgress,
    options: normalizedOptions,
    configuration: configurationPayload,
    analysis: analysisPayload,
    analysisGeneratedAt: toStringISO(job.analysisGeneratedAt),
    lastImportStartedAt: toStringISO(job.lastImportStartedAt),
  };
}
