import { createReadStream, statSync } from "node:fs";
import type { Readable } from "node:stream";
import { Transform } from "node:stream";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import Assembler from "stream-json/Assembler";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import { TestmoStagingService } from "./TestmoStagingService";
import {
  TestmoDatasetSummary,
  TestmoExportAnalyzerOptions,
  TestmoExportSummary,
  TestmoReadableSource,
} from "./types";

const DEFAULT_SAMPLE_ROW_LIMIT = 5;
const STAGING_BATCH_SIZE = 1000; // Batch size for staging to database
const ATTACHMENT_DATASET_PATTERN = /attachment/i;

const DEFAULT_PRESERVE_DATASETS = new Set([
  "users",
  "roles",
  "groups",
  "user_groups",
  "states",
  "statuses",
  "templates",
  "template_fields",
  "fields",
  "field_values",
  "configs",
  "tags",
  "projects",
  "repositories",
  "repository_folders",
  "repository_cases",
  "milestones",
  "sessions",
  "session_results",
  "session_issues",
  "session_tags",
  "session_values",
  "issue_targets",
  "milestone_types",
]);

const DATASET_CONTAINER_KEYS = new Set(["datasets", "entities"]);
const DATASET_DATA_KEYS = new Set(["data", "rows", "records", "items"]);
const DATASET_SCHEMA_KEYS = new Set(["schema", "columns", "fields"]);
const DATASET_NAME_KEYS = new Set(["name", "dataset"]);
const IGNORED_DATASET_KEYS = new Set(["meta", "summary"]);

type StackEntry = {
  type: "object" | "array";
  key: string | null;
  datasetName?: string | null;
};

interface ActiveCapture {
  assembler: Assembler;
  datasetName: string;
  purpose: "schema" | "row";
  completed: boolean;
  rowIndex?: number;
  store: (value: unknown) => void;
}

type InternalDatasetSummary = TestmoDatasetSummary & {
  preserveAllRows: boolean;
};

export interface TestmoExportAnalyzerOptionsWithStaging
  extends TestmoExportAnalyzerOptions {
  jobId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
  onProgress?: (
    bytesRead: number,
    totalBytes: number,
    percentage: number,
    estimatedTimeRemaining?: number | null
  ) => void | Promise<void>;
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createProgressTracker(
  totalBytes: number,
  onProgress?: (
    bytesRead: number,
    totalBytes: number,
    percentage: number,
    estimatedTimeRemaining?: number | null
  ) => void | Promise<void>
): Transform {
  let bytesRead = 0;
  let lastReportedPercentage = -1;
  const REPORT_INTERVAL_PERCENTAGE = 1; // Report every 1% progress
  const startTime = Date.now();

  console.log(`[ProgressTracker] Created for file size: ${totalBytes} bytes`);

  return new Transform({
    transform(chunk: Buffer, encoding, callback) {
      bytesRead += chunk.length;
      const percentage =
        totalBytes > 0 ? Math.floor((bytesRead / totalBytes) * 100) : 0;

      // Only report when percentage changes by at least REPORT_INTERVAL_PERCENTAGE
      if (
        onProgress &&
        percentage >= lastReportedPercentage + REPORT_INTERVAL_PERCENTAGE
      ) {
        lastReportedPercentage = percentage;

        // Calculate ETA
        const now = Date.now();
        const elapsedMs = now - startTime;
        const elapsedSeconds = elapsedMs / 1000;

        let etaMessage = "";
        let etaSeconds: number | null = null;
        if (elapsedSeconds >= 2 && bytesRead > 0 && percentage > 0) {
          const bytesPerSecond = bytesRead / elapsedSeconds;
          const remainingBytes = totalBytes - bytesRead;
          const estimatedSecondsRemaining = remainingBytes / bytesPerSecond;
          etaSeconds = Math.ceil(estimatedSecondsRemaining);

          // Format ETA for logging
          if (estimatedSecondsRemaining < 60) {
            etaMessage = ` - ETA: ${etaSeconds}s`;
          } else if (estimatedSecondsRemaining < 3600) {
            const minutes = Math.ceil(estimatedSecondsRemaining / 60);
            etaMessage = ` - ETA: ${minutes}m`;
          } else {
            const hours = Math.floor(estimatedSecondsRemaining / 3600);
            const minutes = Math.ceil((estimatedSecondsRemaining % 3600) / 60);
            etaMessage = ` - ETA: ${hours}h ${minutes}m`;
          }
        }

        console.log(
          `[ProgressTracker] Progress: ${percentage}% (${bytesRead}/${totalBytes} bytes)${etaMessage}`
        );
        const result = onProgress(bytesRead, totalBytes, percentage, etaSeconds);
        if (result instanceof Promise) {
          result.then(() => callback(null, chunk)).catch(callback);
        } else {
          callback(null, chunk);
        }
      } else {
        callback(null, chunk);
      }
    },
  });
}

function isReadable(value: unknown): value is Readable {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Readable).pipe === "function" &&
    typeof (value as Readable).read === "function"
  );
}

function resolveSource(source: TestmoReadableSource): {
  stream: Readable;
  dispose: () => Promise<void>;
  size?: number;
} {
  if (typeof source === "string") {
    const stream = createReadStream(source);
    const dispose = async () => {
      if (!stream.destroyed) {
        await new Promise<void>((resolve) => {
          stream.once("close", resolve);
          stream.destroy();
        });
      }
    };
    let size: number | undefined;
    try {
      size = statSync(source).size;
    } catch {
      size = undefined;
    }
    return { stream, dispose, size };
  }

  if (source instanceof URL) {
    return resolveSource(fileURLToPath(source));
  }

  if (typeof source === "function") {
    const stream = source();
    if (!isReadable(stream)) {
      throw new TypeError(
        "Testmo readable factory did not return a readable stream"
      );
    }
    const dispose = async () => {
      if (!stream.destroyed) {
        await new Promise<void>((resolve) => {
          stream.once("close", resolve);
          stream.destroy();
        });
      }
    };
    return { stream, dispose };
  }

  if (isReadable(source)) {
    const dispose = async () => {
      if (!source.destroyed) {
        await new Promise<void>((resolve) => {
          source.once("close", resolve);
          source.destroy();
        });
      }
    };
    // Check if stream has size attached (e.g., from S3 ContentLength)
    const size = (source as any).__fileSize as number | undefined;
    return { stream: source, dispose, size };
  }

  throw new TypeError("Unsupported Testmo readable source");
}

function isDatasetContainerKey(key: string | null | undefined): boolean {
  if (!key) {
    return false;
  }
  return DATASET_CONTAINER_KEYS.has(key);
}

function currentDatasetName(stack: StackEntry[]): string | null {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (entry.datasetName) {
      return entry.datasetName;
    }
  }

  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (
      entry.type === "object" &&
      typeof entry.key === "string" &&
      !DATASET_SCHEMA_KEYS.has(entry.key) &&
      !DATASET_DATA_KEYS.has(entry.key) &&
      !isDatasetContainerKey(entry.key) &&
      !IGNORED_DATASET_KEYS.has(entry.key)
    ) {
      const parent = stack[i - 1];
      if (
        parent &&
        parent.type === "object" &&
        (parent.key === null || isDatasetContainerKey(parent.key))
      ) {
        return entry.key;
      }
    }
  }
  return null;
}

function coercePrimitive(chunkName: string, value: unknown): unknown {
  switch (chunkName) {
    case "numberValue":
      return typeof value === "string" ? Number(value) : value;
    case "trueValue":
      return true;
    case "falseValue":
      return false;
    case "nullValue":
      return null;
    default:
      return value;
  }
}

const SAMPLE_TRUNCATION_CONFIG = {
  maxStringLength: 1000,
  maxArrayItems: 10,
  maxObjectKeys: 20,
  maxDepth: 3,
};

function sanitizeSampleValue(value: unknown, depth = 0): unknown {
  if (depth > SAMPLE_TRUNCATION_CONFIG.maxDepth) {
    return "[truncated depth]";
  }

  if (typeof value === "string") {
    if (value.length > SAMPLE_TRUNCATION_CONFIG.maxStringLength) {
      const truncated = value.slice(
        0,
        SAMPLE_TRUNCATION_CONFIG.maxStringLength
      );
      const remaining = value.length - SAMPLE_TRUNCATION_CONFIG.maxStringLength;
      return `${truncated}\u2026 [${remaining} more characters]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, SAMPLE_TRUNCATION_CONFIG.maxArrayItems)
      .map((item) => sanitizeSampleValue(item, depth + 1));
    if (value.length > SAMPLE_TRUNCATION_CONFIG.maxArrayItems) {
      items.push(
        `[${value.length - SAMPLE_TRUNCATION_CONFIG.maxArrayItems} more items]`
      );
    }
    return items;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(
      0,
      SAMPLE_TRUNCATION_CONFIG.maxObjectKeys
    )) {
      result[key] = sanitizeSampleValue(entryValue, depth + 1);
    }
    if (entries.length > SAMPLE_TRUNCATION_CONFIG.maxObjectKeys) {
      result.__truncated_keys__ = `${entries.length - SAMPLE_TRUNCATION_CONFIG.maxObjectKeys} more keys`;
    }
    return result;
  }

  return value;
}

export class TestmoExportAnalyzer {
  private stagingBatches = new Map<
    string,
    Array<{ index: number; data: any }>
  >();
  private stagingService: TestmoStagingService | null = null;
  private jobId: string | null = null;
  private readonly masterRepositoryIds = new Set<number>();

  constructor(
    private readonly defaults: {
      sampleRowLimit: number;
      preserveDatasets: Set<string>;
      maxRowsToPreserve: number;
    } = {
      sampleRowLimit: DEFAULT_SAMPLE_ROW_LIMIT,
      preserveDatasets: DEFAULT_PRESERVE_DATASETS,
      maxRowsToPreserve: Number.POSITIVE_INFINITY,
    }
  ) {}

  /**
   * Analyze a Testmo export and stream data to staging tables.
   */
  async analyze(
    source: TestmoReadableSource,
    options: TestmoExportAnalyzerOptionsWithStaging
  ): Promise<TestmoExportSummary> {
    this.stagingService = new TestmoStagingService(options.prisma);
    this.jobId = options.jobId;
    this.masterRepositoryIds.clear();

    const startedAt = new Date();
    const preserveDatasets =
      options.preserveDatasets ?? this.defaults.preserveDatasets;
    const sampleRowLimit =
      options.sampleRowLimit ?? this.defaults.sampleRowLimit;

    const { stream, dispose, size } = resolveSource(source);
    const abortSignal = options.signal;

    if (abortSignal?.aborted) {
      await dispose();
      throw createAbortError("Testmo export analysis aborted before start");
    }

    const stack: StackEntry[] = [];
    const datasets = new Map<string, InternalDatasetSummary>();
    let lastKey: string | null = null;
    let totalRows = 0;
    let activeCaptures: ActiveCapture[] = [];
    const currentRowIndexes = new Map<string, number>();

    // Create pipeline with progress tracker if size is known
    const pipelineStages: any[] = [stream];
    console.log(
      `[Analyzer] File size: ${size}, onProgress callback: ${!!options.onProgress}`
    );
    if (size && size > 0 && options.onProgress) {
      console.log(`[Analyzer] Adding progress tracker to pipeline`);
      pipelineStages.push(createProgressTracker(size, options.onProgress));
    } else {
      console.log(
        `[Analyzer] NOT adding progress tracker - size: ${size}, hasCallback: ${!!options.onProgress}`
      );
    }
    pipelineStages.push(parser());

    const pipeline = chain(pipelineStages);

    const abortHandler = () => {
      pipeline.destroy(createAbortError("Testmo export analysis aborted"));
    };
    abortSignal?.addEventListener("abort", abortHandler, { once: true });

    const ensureSummary = (name: string): InternalDatasetSummary => {
      let summary = datasets.get(name);
      if (!summary) {
        summary = {
          name,
          rowCount: 0,
          schema: null,
          sampleRows: [],
          truncated: false,
          preserveAllRows: false, // We don't preserve in memory anymore
        };
        datasets.set(name, summary);
        currentRowIndexes.set(name, 0);
      }
      return summary;
    };

    const finalizeCapture = async (capture: ActiveCapture) => {
      if (capture.completed) {
        return;
      }
      const value = capture.assembler.current;

      // If this is a row, stage it
      if (capture.purpose === "row" && this.stagingService && this.jobId) {
        const rowIndex = capture.rowIndex ?? 0;
        await this.stageRow(capture.datasetName, rowIndex, value);

        if (!ATTACHMENT_DATASET_PATTERN.test(capture.datasetName)) {
          const summary = datasets.get(capture.datasetName);
          if (summary && summary.sampleRows.length < sampleRowLimit) {
            summary.sampleRows.push(sanitizeSampleValue(value));
          }
        }
      } else {
        capture.store(value);
      }

      capture.completed = true;
    };

    const handleChunk = async (chunk: any) => {
      try {
        if (abortSignal?.aborted) {
          throw createAbortError("Testmo export analysis aborted");
        }

        if (options.shouldAbort?.()) {
          throw createAbortError("Testmo export analysis aborted");
        }

        for (const capture of activeCaptures) {
          const assemblerAny = capture.assembler as unknown as Record<
            string,
            (value: unknown) => void
          >;
          const handler = assemblerAny[chunk.name];
          if (typeof handler === "function") {
            handler.call(capture.assembler, chunk.value);
          }
        }

        if (activeCaptures.length > 0) {
          const stillActive: ActiveCapture[] = [];
          for (const capture of activeCaptures) {
            if (!capture.completed && capture.assembler.done) {
              await finalizeCapture(capture);
            }
            if (!capture.completed) {
              stillActive.push(capture);
            }
          }
          activeCaptures = stillActive;
        }

        switch (chunk.name) {
          case "startObject": {
            const parent = stack[stack.length - 1];
            const entry: StackEntry = {
              type: "object",
              key: lastKey,
              datasetName: parent?.datasetName ?? null,
            };
            stack.push(entry);

            const parentDataset = parent?.datasetName ?? null;
            if (
              typeof entry.key === "string" &&
              (!DATASET_SCHEMA_KEYS.has(entry.key) || parentDataset === null) &&
              !DATASET_DATA_KEYS.has(entry.key) &&
              !isDatasetContainerKey(entry.key) &&
              !IGNORED_DATASET_KEYS.has(entry.key)
            ) {
              entry.datasetName = entry.key;
            }

            const datasetNameForEntry = currentDatasetName(stack);
            if (datasetNameForEntry) {
              entry.datasetName = entry.datasetName ?? datasetNameForEntry;
              ensureSummary(datasetNameForEntry);
            }

            if (entry.key && DATASET_SCHEMA_KEYS.has(entry.key)) {
              const datasetName = currentDatasetName(stack);
              if (datasetName) {
                const summary = ensureSummary(datasetName);
                const assembler = new Assembler();
                assembler.startObject();
                const capture: ActiveCapture = {
                  assembler,
                  datasetName,
                  purpose: "schema",
                  completed: false,
                  store: (value: unknown) => {
                    summary.schema = (value ?? null) as Record<
                      string,
                      unknown
                    > | null;
                  },
                };
                activeCaptures.push(capture);
              }
            } else if (
              parent?.type === "array" &&
              parent.datasetName &&
              parent.key &&
              DATASET_DATA_KEYS.has(parent.key)
            ) {
              const summary = ensureSummary(parent.datasetName);
              const currentIndex =
                currentRowIndexes.get(parent.datasetName) ?? 0;
              summary.rowCount += 1;
              totalRows += 1;
              currentRowIndexes.set(parent.datasetName, currentIndex + 1);

              // Always capture rows for staging
              const assembler = new Assembler();
              assembler.startObject();
              const capture: ActiveCapture = {
                assembler,
                datasetName: parent.datasetName,
                purpose: "row",
                completed: false,
                rowIndex: currentIndex,
                store: (value: unknown) => {
                  // This is only called for schema captures now
                },
              };
              activeCaptures.push(capture);
            }
            break;
          }
          case "endObject":
            stack.pop();
            break;
          case "startArray": {
            const entry: StackEntry = {
              type: "array",
              key: lastKey,
              datasetName: null,
            };
            if (lastKey && DATASET_DATA_KEYS.has(lastKey)) {
              const datasetName = currentDatasetName(stack);
              if (datasetName) {
                entry.datasetName = datasetName;
              }
            }
            stack.push(entry);
            break;
          }
          case "endArray":
            stack.pop();
            break;
          case "keyValue":
            lastKey = String(chunk.value);
            break;
          case "stringValue":
          case "numberValue":
          case "trueValue":
          case "falseValue":
          case "nullValue":
            coercePrimitive(chunk.name, chunk.value);
            break;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        throw new Error(
          `Error processing chunk: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    try {
      for await (const chunk of pipeline) {
        await handleChunk(chunk);
      }
    } catch (error) {
      console.error(`[Analyzer] Error during analysis:`, error);
      if (error instanceof Error && error.name === "AbortError") {
        // Normal abort, not an error
      } else {
        throw error;
      }
    } finally {
      abortSignal?.removeEventListener("abort", abortHandler);

      // Flush any remaining staging batches
      await this.flushAllStagingBatches();

      // Ensure all active captures are finalized
      for (const capture of activeCaptures) {
        await finalizeCapture(capture);
      }

      // Call onDatasetComplete for each dataset if provided
      if (options.onDatasetComplete) {
        for (const [name, dataset] of datasets) {
          const datasetSummary: TestmoDatasetSummary = {
            name: dataset.name,
            rowCount: dataset.rowCount,
            schema: dataset.schema,
            sampleRows: dataset.sampleRows,
            truncated: dataset.truncated,
          };
          await options.onDatasetComplete(datasetSummary);
        }
      }

      await dispose();
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Convert internal summaries to external format
    const datasetsRecord = Array.from(datasets.values()).reduce(
      (acc, ds) => {
        acc[ds.name] = {
          name: ds.name,
          rowCount: ds.rowCount,
          schema: ds.schema,
          sampleRows: ds.sampleRows,
          truncated: ds.truncated,
        };
        return acc;
      },
      {} as Record<string, TestmoDatasetSummary>
    );

    return {
      datasets: datasetsRecord,
      meta: {
        totalDatasets: datasets.size,
        totalRows,
        durationMs,
        startedAt,
        completedAt,
        fileSizeBytes: size,
      },
    };
  }

  /**
   * Stage a row to the database batch
  */
  private async stageRow(datasetName: string, rowIndex: number, rowData: any) {
    if (ATTACHMENT_DATASET_PATTERN.test(datasetName)) {
      return;
    }

    if (this.shouldSkipRow(datasetName, rowData)) {
      return;
    }

    if (!this.stagingBatches.has(datasetName)) {
      this.stagingBatches.set(datasetName, []);
    }

    const batch = this.stagingBatches.get(datasetName)!;
    batch.push({ index: rowIndex, data: rowData });

    // Flush batch if it reaches the size limit
    if (batch.length >= STAGING_BATCH_SIZE) {
      await this.flushStagingBatch(datasetName);
    }
  }

  /**
   * Flush a specific staging batch to the database
   */
  private async flushStagingBatch(datasetName: string) {
    if (!this.stagingService || !this.jobId) {
      console.error(
        `[Analyzer] Cannot flush batch - no staging service or job ID`
      );
      return;
    }

    const batch = this.stagingBatches.get(datasetName);
    if (!batch || batch.length === 0) return;

    try {
      await this.stagingService.stageBatch(this.jobId, datasetName, batch);
      this.stagingBatches.set(datasetName, []);
    } catch (error) {
      console.error(
        `[Analyzer] Failed to stage batch for dataset ${datasetName}:`,
        error
      );
      // Log more details about the error
      if (error instanceof Error) {
        console.error(`[Analyzer] Error message: ${error.message}`);
        console.error(`[Analyzer] Error stack: ${error.stack}`);
      }
      throw error;
    }
  }

  /**
   * Flush all remaining staging batches
   */
  private async flushAllStagingBatches() {
    const flushPromises: Promise<void>[] = [];

    console.log(
      `[Analyzer] Flushing ${this.stagingBatches.size} dataset batches`
    );
    for (const [datasetName, batch] of this.stagingBatches) {
      if (batch.length > 0) {
        console.log(
          `[Analyzer] Flushing ${batch.length} rows for dataset: ${datasetName}`
        );
        flushPromises.push(this.flushStagingBatch(datasetName));
      }
    }

    await Promise.all(flushPromises);
    console.log(`[Analyzer] All batches flushed`);
  }

  private shouldSkipRow(datasetName: string, rowData: any): boolean {
    if (!rowData || typeof rowData !== "object") {
      return false;
    }

    if (datasetName === "repositories") {
      const repoId = this.toNumberSafe((rowData as any).id);
      const isSnapshot =
        this.toNumberSafe((rowData as any).is_snapshot) === 1 ||
        String((rowData as any).is_snapshot ?? "")
          .toLowerCase()
          .includes("true");
      if (!isSnapshot && repoId !== null) {
        this.masterRepositoryIds.add(repoId);
      }
      return isSnapshot;
    }

    if (
      datasetName.startsWith("repository_") &&
      datasetName !== "repository_case_tags"
    ) {
      const repoId = this.toNumberSafe((rowData as any).repo_id);
      if (repoId !== null && this.masterRepositoryIds.size > 0) {
        return !this.masterRepositoryIds.has(repoId);
      }
    }

    return false;
  }

  private toNumberSafe(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    return null;
  }
}

/**
 * Convenience function for analyzing Testmo exports with staging.
 */
export const analyzeTestmoExport = async (
  source: TestmoReadableSource,
  jobId: string,
  prisma: PrismaClient | Prisma.TransactionClient,
  options?: Omit<TestmoExportAnalyzerOptionsWithStaging, "jobId" | "prisma">
): Promise<TestmoExportSummary> => {
  const analyzer = new TestmoExportAnalyzer();
  return analyzer.analyze(source, {
    ...options,
    jobId,
    prisma,
  });
};
