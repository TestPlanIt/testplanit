import { createReadStream, statSync } from "node:fs";
import type { Readable } from "node:stream";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import Assembler from "stream-json/Assembler";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import {
  TestmoDatasetSummary,
  TestmoExportAnalyzerOptions,
  TestmoExportSummary,
  TestmoReadableSource,
} from "./types";

const DEFAULT_SAMPLE_ROW_LIMIT = 5;
const DEFAULT_MAX_ROWS_TO_PRESERVE = Number.POSITIVE_INFINITY;

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
  store: (value: unknown) => void;
}

type InternalDatasetSummary = TestmoDatasetSummary & {
  allRows?: unknown[];
  preserveAllRows: boolean;
};

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isReadable(value: unknown): value is Readable {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Readable).pipe === "function" &&
    typeof (value as Readable).read === "function"
  );
}

function resolveSource(
  source: TestmoReadableSource
): { stream: Readable; dispose: () => Promise<void>; size?: number } {
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
      throw new TypeError("Testmo readable factory did not return a readable stream");
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
    return { stream: source, dispose };
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
      const truncated = value.slice(0, SAMPLE_TRUNCATION_CONFIG.maxStringLength);
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
      items.push(`[${value.length - SAMPLE_TRUNCATION_CONFIG.maxArrayItems} more items]`);
    }
    return items;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, SAMPLE_TRUNCATION_CONFIG.maxObjectKeys)) {
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
  constructor(
    private readonly defaults: {
      sampleRowLimit: number;
      preserveDatasets: Set<string>;
      maxRowsToPreserve: number;
    } = {
      sampleRowLimit: DEFAULT_SAMPLE_ROW_LIMIT,
      preserveDatasets: DEFAULT_PRESERVE_DATASETS,
      maxRowsToPreserve: DEFAULT_MAX_ROWS_TO_PRESERVE,
    }
  ) {}

  async analyze(
    source: TestmoReadableSource,
    options: TestmoExportAnalyzerOptions = {}
  ): Promise<TestmoExportSummary> {
    const startedAt = new Date();
    const preserveDatasets =
      options.preserveDatasets ?? this.defaults.preserveDatasets;
    const sampleRowLimit =
      options.sampleRowLimit ?? this.defaults.sampleRowLimit;
    const maxRowsToPreserve =
      options.maxRowsToPreserve ?? this.defaults.maxRowsToPreserve;

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

    const pipeline = chain([stream, parser()]);

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
          preserveAllRows: preserveDatasets.has(name),
        };
        if (summary.preserveAllRows) {
          summary.allRows = [];
        }
        datasets.set(name, summary);
      }
      return summary;
    };

    const finalizeCapture = (capture: ActiveCapture) => {
      if (capture.completed) {
        return;
      }
      const value = capture.assembler.current;
      capture.store(value);
      capture.completed = true;
    };

    const handleChunk = (chunk: any) => {
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
              finalizeCapture(capture);
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
                    summary.schema = (value ?? null) as Record<string, unknown> | null;
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
              summary.rowCount += 1;
              totalRows += 1;

              if (
                summary.sampleRows.length < sampleRowLimit ||
                (summary.preserveAllRows &&
                  (summary.allRows?.length ?? 0) < maxRowsToPreserve)
              ) {
                const assembler = new Assembler();
                assembler.startObject();
                const capture: ActiveCapture = {
                  assembler,
                  datasetName: parent.datasetName,
                  purpose: "row",
                  completed: false,
                  store: (value: unknown) => {
                    if (summary.sampleRows.length < sampleRowLimit) {
                      summary.sampleRows.push(sanitizeSampleValue(value));
                    }
                    if (
                      summary.preserveAllRows &&
                      summary.allRows &&
                      summary.allRows.length < maxRowsToPreserve
                    ) {
                      summary.allRows.push(value);
                    }
                  },
                };
                activeCaptures.push(capture);
              }
            }
            lastKey = null;
            break;
          }

          case "endObject": {
            stack.pop();
            break;
          }

          case "startArray": {
            const datasetName =
              lastKey && DATASET_DATA_KEYS.has(lastKey)
                ? currentDatasetName(stack)
                : null;
            const entry: StackEntry = {
              type: "array",
              key: lastKey,
              datasetName,
            };
            stack.push(entry);
            lastKey = null;
            break;
          }

        case "endArray": {
          const entry = stack.pop();
          if (entry?.datasetName) {
            const datasetSummary = ensureSummary(entry.datasetName);
            const truncatedBySample =
              datasetSummary.rowCount > datasetSummary.sampleRows.length;
            const truncatedByPreserve = datasetSummary.preserveAllRows
              ? (datasetSummary.allRows?.length ?? 0) < datasetSummary.rowCount
              : truncatedBySample;
            datasetSummary.truncated = truncatedByPreserve;

            const maybePromise = options.onDatasetComplete?.({
              name: datasetSummary.name,
              rowCount: datasetSummary.rowCount,
              schema: datasetSummary.schema ?? null,
              sampleRows: datasetSummary.sampleRows,
              allRows: datasetSummary.allRows,
              truncated: datasetSummary.truncated,
            });

            if (
              maybePromise &&
              typeof (maybePromise as Promise<unknown>).then === "function"
            ) {
              pipeline.pause();
              Promise.resolve(maybePromise)
                .catch((error) => {
                  pipeline.destroy(error as Error);
                })
                .finally(() => {
                  if (!pipeline.destroyed) {
                    pipeline.resume();
                  }
                });
            }
          }
          break;
        }

          case "keyValue": {
            lastKey = chunk.value as string;
            break;
          }

          case "stringValue":
          case "numberValue":
          case "trueValue":
          case "falseValue":
          case "nullValue": {
            if (lastKey && DATASET_NAME_KEYS.has(lastKey)) {
              const nameValue =
                chunk.name === "stringValue"
                  ? (chunk.value as string)
                  : String(chunk.value ?? "");
              if (nameValue) {
                const currentEntry = stack[stack.length - 1];
                const parentEntry = stack[stack.length - 2];

                if (
                  currentEntry &&
                  currentEntry.type === "object" &&
                  !currentEntry.datasetName
                ) {
                  const entryKey = currentEntry.key;
                  const isAllowedKey =
                    entryKey === null ||
                    (typeof entryKey === "string" &&
                      !DATASET_SCHEMA_KEYS.has(entryKey) &&
                      !DATASET_DATA_KEYS.has(entryKey) &&
                      !isDatasetContainerKey(entryKey) &&
                      !IGNORED_DATASET_KEYS.has(entryKey));
                  const isParentDataArray =
                    parentEntry &&
                    parentEntry.type === "array" &&
                    parentEntry.key !== null &&
                    DATASET_DATA_KEYS.has(parentEntry.key);
                  const isParentSchemaObject =
                    parentEntry &&
                    parentEntry.type === "object" &&
                    parentEntry.key !== null &&
                    DATASET_SCHEMA_KEYS.has(parentEntry.key);

                  if (isAllowedKey && !isParentDataArray && !isParentSchemaObject) {
                    currentEntry.datasetName = nameValue;
                    ensureSummary(nameValue);
                  }
                }
              }
              lastKey = null;
              break;
            }

            const parent = stack[stack.length - 1];

            if (lastKey && DATASET_SCHEMA_KEYS.has(lastKey)) {
              const datasetName = currentDatasetName(stack);
              if (datasetName) {
                const summary = ensureSummary(datasetName);
                summary.schema = coercePrimitive(chunk.name, chunk.value) as
                  | Record<string, unknown>
                  | null;
              }
              lastKey = null;
              break;
            }

            if (
              parent?.type === "array" &&
              parent.datasetName &&
              parent.key &&
              DATASET_DATA_KEYS.has(parent.key)
            ) {
              const summary = ensureSummary(parent.datasetName);
              summary.rowCount += 1;
              totalRows += 1;
              const value = coercePrimitive(chunk.name, chunk.value);
              if (summary.sampleRows.length < sampleRowLimit) {
                summary.sampleRows.push(value);
              }
              if (
                summary.preserveAllRows &&
                summary.allRows &&
                summary.allRows.length < maxRowsToPreserve
              ) {
                summary.allRows.push(value);
              }
            }

            lastKey = null;
            break;
          }

          default:
            break;
        }
      } catch (error) {
        pipeline.destroy(error as Error);
      }
    };

    const handleError = (error: unknown) => {
      pipeline.destroy(error as Error);
    };

    try {
      pipeline.on("data", handleChunk);
      pipeline.once("error", handleError);
      await once(pipeline, "end");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw error;
      }
      throw error;
    } finally {
      abortSignal?.removeEventListener("abort", abortHandler);
      pipeline.off("data", handleChunk);
      pipeline.removeListener("error", handleError);
      pipeline.destroy();
      await dispose();
    }

    const completedAt = new Date();

    const datasetSummaries: Record<string, TestmoDatasetSummary> = {};
    for (const [name, summary] of datasets) {
      const truncatedBySample = summary.rowCount > summary.sampleRows.length;
      const truncatedByPreserve = summary.preserveAllRows
        ? (summary.allRows?.length ?? 0) < summary.rowCount
        : truncatedBySample;
      summary.truncated = truncatedByPreserve;
      datasetSummaries[name] = {
        name,
        rowCount: summary.rowCount,
        schema: summary.schema ?? null,
        sampleRows: summary.sampleRows,
        allRows: summary.allRows,
        truncated: summary.truncated,
      };
    }

    return {
      datasets: datasetSummaries,
      meta: {
        totalDatasets: datasets.size,
        totalRows,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        fileSizeBytes: size,
      },
    };
  }
}

export const analyzeTestmoExport = async (
  source: TestmoReadableSource,
  options?: TestmoExportAnalyzerOptions
): Promise<TestmoExportSummary> =>
  new TestmoExportAnalyzer().analyze(source, options);
