"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// workers/testmoImportWorker.ts
var import_bullmq2 = require("bullmq");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client5 = require("@prisma/client");
var import_core2 = require("@tiptap/core");
var import_model2 = require("@tiptap/pm/model");
var import_happy_dom2 = require("happy-dom");
var import_starter_kit2 = __toESM(require("@tiptap/starter-kit"));
var import_node_url2 = require("node:url");
var import_bcrypt = __toESM(require("bcrypt"));

// lib/multiTenantPrisma.ts
var import_client = require("@prisma/client");
function isMultiTenantMode() {
  return process.env.MULTI_TENANT_MODE === "true";
}
var tenantClients = /* @__PURE__ */ new Map();
async function disconnectAllTenantClients() {
  const disconnectPromises = [];
  for (const [tenantId, client] of tenantClients) {
    console.log(`Disconnecting Prisma client for tenant: ${tenantId}`);
    disconnectPromises.push(client.$disconnect());
  }
  await Promise.all(disconnectPromises);
  tenantClients.clear();
  console.log("All tenant Prisma clients disconnected");
}

// lib/valkey.ts
var import_ioredis = __toESM(require("ioredis"));
var skipConnection = process.env.SKIP_VALKEY_CONNECTION === "true";
var valkeyUrl = process.env.VALKEY_URL;
if (!valkeyUrl && !skipConnection) {
  console.error(
    "VALKEY_URL environment variable is not set. Background jobs may fail."
  );
}
var connectionOptions = {
  maxRetriesPerRequest: null,
  // Required by BullMQ
  enableReadyCheck: false
  // Optional: Sometimes helps with startup race conditions
};
var valkeyConnection = null;
if (valkeyUrl && !skipConnection) {
  const connectionUrl = valkeyUrl.replace(/^valkey:\/\//, "redis://");
  valkeyConnection = new import_ioredis.default(connectionUrl, connectionOptions);
  valkeyConnection.on("connect", () => {
    console.log("Successfully connected to Valkey.");
  });
  valkeyConnection.on("error", (err) => {
    console.error("Valkey connection error:", err);
  });
} else {
  console.warn("Valkey URL not provided. Valkey connection not established.");
}
var valkey_default = valkeyConnection;

// lib/queues.ts
var import_bullmq = require("bullmq");

// lib/queueNames.ts
var TESTMO_IMPORT_QUEUE_NAME = "testmo-imports";
var ELASTICSEARCH_REINDEX_QUEUE_NAME = "elasticsearch-reindex";

// lib/queues.ts
var _elasticsearchReindexQueue = null;
function getElasticsearchReindexQueue() {
  if (_elasticsearchReindexQueue) return _elasticsearchReindexQueue;
  if (!valkey_default) {
    console.warn(`Valkey connection not available, Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" not initialized.`);
    return null;
  }
  _elasticsearchReindexQueue = new import_bullmq.Queue(ELASTICSEARCH_REINDEX_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: {
        age: 3600 * 24 * 7,
        count: 50
      },
      removeOnFail: {
        age: 3600 * 24 * 14
      }
    }
  });
  console.log(`Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" initialized.`);
  _elasticsearchReindexQueue.on("error", (error) => {
    console.error(`Queue ${ELASTICSEARCH_REINDEX_QUEUE_NAME} error:`, error);
  });
  return _elasticsearchReindexQueue;
}

// services/imports/testmo/TestmoExportAnalyzer.ts
var import_node_fs = require("node:fs");
var import_node_stream = require("node:stream");
var import_stream_chain = require("stream-chain");
var import_stream_json = require("stream-json");
var import_Assembler = __toESM(require("stream-json/Assembler"));
var import_node_url = require("node:url");

// services/imports/testmo/TestmoStagingService.ts
var TestmoStagingService = class {
  constructor(prisma2) {
    this.prisma = prisma2;
  }
  prepareStagingRow(jobId, datasetName, rowIndex, rowData) {
    let sanitizedData = rowData;
    let fieldName = null;
    let fieldValue = null;
    let text1 = null;
    let text2 = null;
    let text3 = null;
    let text4 = null;
    if (datasetName === "automation_run_test_fields" && rowData && typeof rowData === "object" && !Array.isArray(rowData)) {
      const clone = { ...rowData };
      const rawValue = clone.value;
      if (rawValue !== void 0) {
        if (typeof rawValue === "string") {
          fieldValue = rawValue;
        } else if (rawValue !== null) {
          try {
            fieldValue = JSON.stringify(rawValue);
          } catch {
            fieldValue = String(rawValue);
          }
        }
        delete clone.value;
      }
      const rawName = rowData.name;
      if (typeof rawName === "string") {
        fieldName = rawName;
      }
      sanitizedData = clone;
    }
    if (datasetName === "run_result_steps" && rowData && typeof rowData === "object" && !Array.isArray(rowData)) {
      const clone = { ...rowData };
      const extractText = (key) => {
        const raw = clone[key];
        if (raw === void 0) {
          return null;
        }
        delete clone[key];
        if (raw === null) {
          return null;
        }
        if (typeof raw === "string") {
          return raw;
        }
        try {
          return JSON.stringify(raw);
        } catch {
          return String(raw);
        }
      };
      text1 = extractText("text1");
      text2 = extractText("text2");
      text3 = extractText("text3");
      text4 = extractText("text4");
      sanitizedData = clone;
    }
    return {
      jobId,
      datasetName,
      rowIndex,
      rowData: sanitizedData,
      fieldName,
      fieldValue,
      text1,
      text2,
      text3,
      text4,
      processed: false
    };
  }
  /**
   * Stage a single dataset row for later processing
   */
  async stageDatasetRow(jobId, datasetName, rowIndex, rowData) {
    return this.prisma.testmoImportStaging.create({
      data: this.prepareStagingRow(jobId, datasetName, rowIndex, rowData)
    });
  }
  /**
   * Batch stage multiple rows for better performance
   */
  async stageBatch(jobId, datasetName, rows) {
    if (rows.length === 0) return { count: 0 };
    const data = rows.map(
      ({ index, data: data2 }) => this.prepareStagingRow(jobId, datasetName, index, data2)
    );
    return this.prisma.testmoImportStaging.createMany({ data });
  }
  /**
   * Store or update an entity mapping
   */
  async storeMapping(jobId, entityType, sourceId, targetId, targetType, metadata) {
    return this.prisma.testmoImportMapping.upsert({
      where: {
        jobId_entityType_sourceId: {
          jobId,
          entityType,
          sourceId
        }
      },
      create: {
        jobId,
        entityType,
        sourceId,
        targetId,
        targetType,
        metadata
      },
      update: {
        targetId,
        targetType,
        metadata
      }
    });
  }
  /**
   * Batch store multiple mappings
   */
  async storeMappingBatch(jobId, mappings) {
    if (mappings.length === 0) return { count: 0 };
    const operations = mappings.map(
      (mapping) => this.prisma.testmoImportMapping.upsert({
        where: {
          jobId_entityType_sourceId: {
            jobId,
            entityType: mapping.entityType,
            sourceId: mapping.sourceId
          }
        },
        create: {
          jobId,
          entityType: mapping.entityType,
          sourceId: mapping.sourceId,
          targetId: mapping.targetId,
          targetType: mapping.targetType,
          metadata: mapping.metadata
        },
        update: {
          targetId: mapping.targetId,
          targetType: mapping.targetType,
          metadata: mapping.metadata
        }
      })
    );
    const results = await Promise.all(operations);
    return { count: results.length };
  }
  /**
   * Get a specific mapping
   */
  async getMapping(jobId, entityType, sourceId) {
    return this.prisma.testmoImportMapping.findUnique({
      where: {
        jobId_entityType_sourceId: {
          jobId,
          entityType,
          sourceId
        }
      }
    });
  }
  /**
   * Get all mappings for a specific entity type
   */
  async getMappingsByType(jobId, entityType) {
    return this.prisma.testmoImportMapping.findMany({
      where: {
        jobId,
        entityType
      }
    });
  }
  /**
   * Process staged rows in batches with cursor pagination.
   * This allows processing large datasets without loading everything into memory.
   */
  async processStagedBatch(jobId, datasetName, batchSize, processor2) {
    let cursor;
    let processedCount = 0;
    let errorCount = 0;
    while (true) {
      const batch = await this.prisma.testmoImportStaging.findMany({
        where: {
          jobId,
          datasetName,
          processed: false
        },
        take: batchSize,
        cursor: cursor ? { id: cursor } : void 0,
        orderBy: { rowIndex: "asc" }
        // Maintain original order
      });
      if (batch.length === 0) break;
      try {
        const processedIds = await processor2(
          batch.map((b) => ({
            id: b.id,
            rowIndex: b.rowIndex,
            rowData: b.rowData,
            fieldName: b.fieldName,
            fieldValue: b.fieldValue,
            text1: b.text1,
            text2: b.text2,
            text3: b.text3,
            text4: b.text4
          }))
        );
        if (processedIds.length > 0) {
          await this.prisma.testmoImportStaging.updateMany({
            where: { id: { in: processedIds } },
            data: { processed: true }
          });
          processedCount += processedIds.length;
        }
        const failedIds = batch.filter((b) => !processedIds.includes(b.id)).map((b) => b.id);
        if (failedIds.length > 0) {
          await this.prisma.testmoImportStaging.updateMany({
            where: { id: { in: failedIds } },
            data: {
              processed: true,
              error: "Processing failed"
            }
          });
          errorCount += failedIds.length;
        }
      } catch (error) {
        const ids = batch.map((b) => b.id);
        await this.prisma.testmoImportStaging.updateMany({
          where: { id: { in: ids } },
          data: {
            processed: true,
            error: error instanceof Error ? error.message : "Unknown error"
          }
        });
        errorCount += batch.length;
      }
      cursor = batch[batch.length - 1].id;
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { processedCount, errorCount };
  }
  /**
   * Get count of unprocessed rows for progress tracking
   */
  async getUnprocessedCount(jobId, datasetName) {
    return this.prisma.testmoImportStaging.count({
      where: {
        jobId,
        ...datasetName && { datasetName },
        processed: false
      }
    });
  }
  /**
   * Get total count of rows for a dataset
   */
  async getTotalCount(jobId, datasetName) {
    return this.prisma.testmoImportStaging.count({
      where: {
        jobId,
        ...datasetName && { datasetName }
      }
    });
  }
  /**
   * Get processing statistics
   */
  async getProcessingStats(jobId, datasetName) {
    const where = {
      jobId,
      ...datasetName && { datasetName }
    };
    const [total, processed, errors] = await Promise.all([
      this.prisma.testmoImportStaging.count({ where }),
      this.prisma.testmoImportStaging.count({
        where: { ...where, processed: true, error: null }
      }),
      this.prisma.testmoImportStaging.count({
        where: { ...where, processed: true, error: { not: null } }
      })
    ]);
    return {
      total,
      processed,
      errors,
      pending: total - processed - errors,
      percentComplete: total > 0 ? Math.round((processed + errors) / total * 100) : 0
    };
  }
  /**
   * Get failed rows with error details
   */
  async getFailedRows(jobId, datasetName, limit = 100) {
    return this.prisma.testmoImportStaging.findMany({
      where: {
        jobId,
        ...datasetName && { datasetName },
        processed: true,
        error: { not: null }
      },
      take: limit,
      orderBy: { rowIndex: "asc" },
      select: {
        id: true,
        rowIndex: true,
        datasetName: true,
        error: true,
        rowData: true
      }
    });
  }
  /**
   * Reset processing status for failed rows (for retry)
   */
  async resetFailedRows(jobId, datasetName) {
    return this.prisma.testmoImportStaging.updateMany({
      where: {
        jobId,
        ...datasetName && { datasetName },
        processed: true,
        error: { not: null }
      },
      data: {
        processed: false,
        error: null
      }
    });
  }
  /**
   * Mark specific rows as failed with an error message
   */
  async markFailed(ids, error) {
    return this.prisma.testmoImportStaging.updateMany({
      where: { id: { in: ids } },
      data: {
        processed: true,
        error
      }
    });
  }
  /**
   * Clean up all staging data for a job
   */
  async cleanup(jobId) {
    await Promise.all([
      this.prisma.testmoImportStaging.deleteMany({ where: { jobId } }),
      this.prisma.testmoImportMapping.deleteMany({ where: { jobId } })
    ]);
  }
  /**
   * Clean up only processed staging data (keep mappings)
   */
  async cleanupProcessedStaging(jobId) {
    return this.prisma.testmoImportStaging.deleteMany({
      where: {
        jobId,
        processed: true
      }
    });
  }
  /**
   * Check if a job has staging data
   */
  async hasStagingData(jobId) {
    const count = await this.prisma.testmoImportStaging.count({
      where: { jobId },
      take: 1
    });
    return count > 0;
  }
  /**
   * Get distinct dataset names for a job
   */
  async getDatasetNames(jobId) {
    const results = await this.prisma.testmoImportStaging.findMany({
      where: { jobId },
      distinct: ["datasetName"],
      select: { datasetName: true }
    });
    return results.map((r) => r.datasetName);
  }
};

// services/imports/testmo/TestmoExportAnalyzer.ts
var DEFAULT_SAMPLE_ROW_LIMIT = 5;
var STAGING_BATCH_SIZE = 1e3;
var ATTACHMENT_DATASET_PATTERN = /attachment/i;
var DEFAULT_PRESERVE_DATASETS = /* @__PURE__ */ new Set([
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
  "milestone_types"
]);
var DATASET_CONTAINER_KEYS = /* @__PURE__ */ new Set(["datasets", "entities"]);
var DATASET_DATA_KEYS = /* @__PURE__ */ new Set(["data", "rows", "records", "items"]);
var DATASET_SCHEMA_KEYS = /* @__PURE__ */ new Set(["schema", "columns", "fields"]);
var IGNORED_DATASET_KEYS = /* @__PURE__ */ new Set(["meta", "summary"]);
function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
function createProgressTracker(totalBytes, onProgress) {
  let bytesRead = 0;
  let lastReportedPercentage = -1;
  const REPORT_INTERVAL_PERCENTAGE = 1;
  const startTime = Date.now();
  console.log(`[ProgressTracker] Created for file size: ${totalBytes} bytes`);
  return new import_node_stream.Transform({
    transform(chunk, encoding, callback) {
      bytesRead += chunk.length;
      const percentage = totalBytes > 0 ? Math.floor(bytesRead / totalBytes * 100) : 0;
      if (onProgress && percentage >= lastReportedPercentage + REPORT_INTERVAL_PERCENTAGE) {
        lastReportedPercentage = percentage;
        const now = Date.now();
        const elapsedMs = now - startTime;
        const elapsedSeconds = elapsedMs / 1e3;
        let etaMessage = "";
        let etaSeconds = null;
        if (elapsedSeconds >= 2 && bytesRead > 0 && percentage > 0) {
          const bytesPerSecond = bytesRead / elapsedSeconds;
          const remainingBytes = totalBytes - bytesRead;
          const estimatedSecondsRemaining = remainingBytes / bytesPerSecond;
          etaSeconds = Math.ceil(estimatedSecondsRemaining);
          if (estimatedSecondsRemaining < 60) {
            etaMessage = ` - ETA: ${etaSeconds}s`;
          } else if (estimatedSecondsRemaining < 3600) {
            const minutes = Math.ceil(estimatedSecondsRemaining / 60);
            etaMessage = ` - ETA: ${minutes}m`;
          } else {
            const hours = Math.floor(estimatedSecondsRemaining / 3600);
            const minutes = Math.ceil(estimatedSecondsRemaining % 3600 / 60);
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
    }
  });
}
function isReadable(value) {
  return !!value && typeof value === "object" && typeof value.pipe === "function" && typeof value.read === "function";
}
function resolveSource(source) {
  if (typeof source === "string") {
    const stream = (0, import_node_fs.createReadStream)(source);
    const dispose = async () => {
      if (!stream.destroyed) {
        await new Promise((resolve) => {
          stream.once("close", resolve);
          stream.destroy();
        });
      }
    };
    let size;
    try {
      size = (0, import_node_fs.statSync)(source).size;
    } catch {
      size = void 0;
    }
    return { stream, dispose, size };
  }
  if (source instanceof URL) {
    return resolveSource((0, import_node_url.fileURLToPath)(source));
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
        await new Promise((resolve) => {
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
        await new Promise((resolve) => {
          source.once("close", resolve);
          source.destroy();
        });
      }
    };
    const size = source.__fileSize;
    return { stream: source, dispose, size };
  }
  throw new TypeError("Unsupported Testmo readable source");
}
function isDatasetContainerKey(key) {
  if (!key) {
    return false;
  }
  return DATASET_CONTAINER_KEYS.has(key);
}
function currentDatasetName(stack) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (entry.datasetName) {
      return entry.datasetName;
    }
  }
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (entry.type === "object" && typeof entry.key === "string" && !DATASET_SCHEMA_KEYS.has(entry.key) && !DATASET_DATA_KEYS.has(entry.key) && !isDatasetContainerKey(entry.key) && !IGNORED_DATASET_KEYS.has(entry.key)) {
      const parent = stack[i - 1];
      if (parent && parent.type === "object" && (parent.key === null || isDatasetContainerKey(parent.key))) {
        return entry.key;
      }
    }
  }
  return null;
}
function coercePrimitive(chunkName, value) {
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
var SAMPLE_TRUNCATION_CONFIG = {
  maxStringLength: 1e3,
  maxArrayItems: 10,
  maxObjectKeys: 20,
  maxDepth: 3
};
function sanitizeSampleValue(value, depth = 0) {
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
    const items = value.slice(0, SAMPLE_TRUNCATION_CONFIG.maxArrayItems).map((item) => sanitizeSampleValue(item, depth + 1));
    if (value.length > SAMPLE_TRUNCATION_CONFIG.maxArrayItems) {
      items.push(
        `[${value.length - SAMPLE_TRUNCATION_CONFIG.maxArrayItems} more items]`
      );
    }
    return items;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const result = {};
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
var TestmoExportAnalyzer = class {
  constructor(defaults = {
    sampleRowLimit: DEFAULT_SAMPLE_ROW_LIMIT,
    preserveDatasets: DEFAULT_PRESERVE_DATASETS,
    maxRowsToPreserve: Number.POSITIVE_INFINITY
  }) {
    this.defaults = defaults;
  }
  stagingBatches = /* @__PURE__ */ new Map();
  stagingService = null;
  jobId = null;
  masterRepositoryIds = /* @__PURE__ */ new Set();
  /**
   * Analyze a Testmo export and stream data to staging tables.
   */
  async analyze(source, options) {
    this.stagingService = new TestmoStagingService(options.prisma);
    this.jobId = options.jobId;
    this.masterRepositoryIds.clear();
    const startedAt = /* @__PURE__ */ new Date();
    const preserveDatasets = options.preserveDatasets ?? this.defaults.preserveDatasets;
    const sampleRowLimit = options.sampleRowLimit ?? this.defaults.sampleRowLimit;
    const { stream, dispose, size } = resolveSource(source);
    const abortSignal = options.signal;
    if (abortSignal?.aborted) {
      await dispose();
      throw createAbortError("Testmo export analysis aborted before start");
    }
    const stack = [];
    const datasets = /* @__PURE__ */ new Map();
    let lastKey = null;
    let totalRows = 0;
    let activeCaptures = [];
    const currentRowIndexes = /* @__PURE__ */ new Map();
    const pipelineStages = [stream];
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
    pipelineStages.push((0, import_stream_json.parser)());
    const pipeline = (0, import_stream_chain.chain)(pipelineStages);
    const abortHandler = () => {
      pipeline.destroy(createAbortError("Testmo export analysis aborted"));
    };
    abortSignal?.addEventListener("abort", abortHandler, { once: true });
    const ensureSummary = (name) => {
      let summary = datasets.get(name);
      if (!summary) {
        summary = {
          name,
          rowCount: 0,
          schema: null,
          sampleRows: [],
          truncated: false,
          preserveAllRows: false
          // We don't preserve in memory anymore
        };
        datasets.set(name, summary);
        currentRowIndexes.set(name, 0);
      }
      return summary;
    };
    const finalizeCapture = async (capture) => {
      if (capture.completed) {
        return;
      }
      const value = capture.assembler.current;
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
    const handleChunk = async (chunk) => {
      try {
        if (abortSignal?.aborted) {
          throw createAbortError("Testmo export analysis aborted");
        }
        if (options.shouldAbort?.()) {
          throw createAbortError("Testmo export analysis aborted");
        }
        for (const capture of activeCaptures) {
          const assemblerAny = capture.assembler;
          const handler = assemblerAny[chunk.name];
          if (typeof handler === "function") {
            handler.call(capture.assembler, chunk.value);
          }
        }
        if (activeCaptures.length > 0) {
          const stillActive = [];
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
            const entry = {
              type: "object",
              key: lastKey,
              datasetName: parent?.datasetName ?? null
            };
            stack.push(entry);
            const parentDataset = parent?.datasetName ?? null;
            if (typeof entry.key === "string" && (!DATASET_SCHEMA_KEYS.has(entry.key) || parentDataset === null) && !DATASET_DATA_KEYS.has(entry.key) && !isDatasetContainerKey(entry.key) && !IGNORED_DATASET_KEYS.has(entry.key)) {
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
                const assembler = new import_Assembler.default();
                assembler.startObject();
                const capture = {
                  assembler,
                  datasetName,
                  purpose: "schema",
                  completed: false,
                  store: (value) => {
                    summary.schema = value ?? null;
                  }
                };
                activeCaptures.push(capture);
              }
            } else if (parent?.type === "array" && parent.datasetName && parent.key && DATASET_DATA_KEYS.has(parent.key)) {
              const summary = ensureSummary(parent.datasetName);
              const currentIndex = currentRowIndexes.get(parent.datasetName) ?? 0;
              summary.rowCount += 1;
              totalRows += 1;
              currentRowIndexes.set(parent.datasetName, currentIndex + 1);
              const assembler = new import_Assembler.default();
              assembler.startObject();
              const capture = {
                assembler,
                datasetName: parent.datasetName,
                purpose: "row",
                completed: false,
                rowIndex: currentIndex,
                store: (value) => {
                }
              };
              activeCaptures.push(capture);
            }
            break;
          }
          case "endObject":
            stack.pop();
            break;
          case "startArray": {
            const entry = {
              type: "array",
              key: lastKey,
              datasetName: null
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
      } else {
        throw error;
      }
    } finally {
      abortSignal?.removeEventListener("abort", abortHandler);
      await this.flushAllStagingBatches();
      for (const capture of activeCaptures) {
        await finalizeCapture(capture);
      }
      if (options.onDatasetComplete) {
        for (const [name, dataset] of datasets) {
          const datasetSummary = {
            name: dataset.name,
            rowCount: dataset.rowCount,
            schema: dataset.schema,
            sampleRows: dataset.sampleRows,
            truncated: dataset.truncated
          };
          await options.onDatasetComplete(datasetSummary);
        }
      }
      await dispose();
    }
    const completedAt = /* @__PURE__ */ new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const datasetsRecord = Array.from(datasets.values()).reduce(
      (acc, ds) => {
        acc[ds.name] = {
          name: ds.name,
          rowCount: ds.rowCount,
          schema: ds.schema,
          sampleRows: ds.sampleRows,
          truncated: ds.truncated
        };
        return acc;
      },
      {}
    );
    return {
      datasets: datasetsRecord,
      meta: {
        totalDatasets: datasets.size,
        totalRows,
        durationMs,
        startedAt,
        completedAt,
        fileSizeBytes: size
      }
    };
  }
  /**
   * Stage a row to the database batch
  */
  async stageRow(datasetName, rowIndex, rowData) {
    if (ATTACHMENT_DATASET_PATTERN.test(datasetName)) {
      return;
    }
    if (this.shouldSkipRow(datasetName, rowData)) {
      return;
    }
    if (!this.stagingBatches.has(datasetName)) {
      this.stagingBatches.set(datasetName, []);
    }
    const batch = this.stagingBatches.get(datasetName);
    batch.push({ index: rowIndex, data: rowData });
    if (batch.length >= STAGING_BATCH_SIZE) {
      await this.flushStagingBatch(datasetName);
    }
  }
  /**
   * Flush a specific staging batch to the database
   */
  async flushStagingBatch(datasetName) {
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
  async flushAllStagingBatches() {
    const flushPromises = [];
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
  shouldSkipRow(datasetName, rowData) {
    if (!rowData || typeof rowData !== "object") {
      return false;
    }
    if (datasetName === "repositories") {
      const repoId = this.toNumberSafe(rowData.id);
      const isSnapshot = this.toNumberSafe(rowData.is_snapshot) === 1 || String(rowData.is_snapshot ?? "").toLowerCase().includes("true");
      if (!isSnapshot && repoId !== null) {
        this.masterRepositoryIds.add(repoId);
      }
      return isSnapshot;
    }
    if (datasetName.startsWith("repository_") && datasetName !== "repository_case_tags") {
      const repoId = this.toNumberSafe(rowData.repo_id);
      if (repoId !== null && this.masterRepositoryIds.size > 0) {
        return !this.masterRepositoryIds.has(repoId);
      }
    }
    return false;
  }
  toNumberSafe(value) {
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
};
var analyzeTestmoExport = async (source, jobId, prisma2, options) => {
  const analyzer = new TestmoExportAnalyzer();
  return analyzer.analyze(source, {
    ...options,
    jobId,
    prisma: prisma2
  });
};

// utils/randomPassword.ts
var DEFAULT_LENGTH = 16;
var CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";
var generateRandomPassword = (length = DEFAULT_LENGTH) => {
  const targetLength = Math.max(8, length);
  const values = typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(targetLength)) : null;
  const result = [];
  if (values) {
    for (let i = 0; i < targetLength; i += 1) {
      const index = values[i] % CHARSET.length;
      result.push(CHARSET[index]);
    }
    return result.join("");
  }
  for (let i = 0; i < targetLength; i += 1) {
    const index = Math.floor(Math.random() * CHARSET.length);
    result.push(CHARSET[index]);
  }
  return result.join("");
};

// services/imports/testmo/configuration.ts
var ACTION_MAP = /* @__PURE__ */ new Set(["map", "create"]);
var CONFIG_VARIANT_ACTIONS = /* @__PURE__ */ new Set([
  "map-variant",
  "create-variant-existing-category",
  "create-category-variant"
]);
var toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};
var toBoolean = (value, fallback = false) => {
  if (value === null || value === void 0) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return fallback;
};
var toStringValue = (value) => {
  if (typeof value !== "string") {
    return void 0;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
};
var toAccessValue = (value) => {
  if (typeof value !== "string") {
    return void 0;
  }
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "ADMIN":
    case "USER":
    case "PROJECTADMIN":
    case "NONE":
      return normalized;
    default:
      return void 0;
  }
};
var createEmptyMappingConfiguration = () => ({
  workflows: {},
  statuses: {},
  roles: {},
  milestoneTypes: {},
  groups: {},
  tags: {},
  issueTargets: {},
  users: {},
  configurations: {},
  templateFields: {},
  templates: {},
  customFields: {}
});
var normalizeWorkflowConfig = (value) => {
  const base = {
    action: "map",
    mappedTo: null,
    workflowType: null,
    name: null,
    scope: null,
    iconId: null,
    colorId: null
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "map";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "map";
  const mappedTo = toNumber(record.mappedTo);
  const workflowType = typeof record.workflowType === "string" ? record.workflowType : typeof record.suggestedWorkflowType === "string" ? record.suggestedWorkflowType : null;
  const name = typeof record.name === "string" ? record.name : base.name;
  const scope = typeof record.scope === "string" ? record.scope : base.scope;
  const iconId = toNumber(record.iconId);
  const colorId = toNumber(record.colorId);
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    workflowType,
    name: action === "create" ? name : void 0,
    scope: action === "create" ? scope : void 0,
    iconId: action === "create" ? iconId ?? null : void 0,
    colorId: action === "create" ? colorId ?? null : void 0
  };
};
var normalizeStatusConfig = (value) => {
  const base = {
    action: "create",
    mappedTo: null,
    name: void 0,
    systemName: void 0,
    colorHex: void 0,
    colorId: null,
    aliases: void 0,
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    isEnabled: true,
    scopeIds: []
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "create";
  const mappedTo = toNumber(record.mappedTo);
  const colorId = toNumber(record.colorId);
  const scopeIds = Array.isArray(record.scopeIds) ? record.scopeIds.map((value2) => toNumber(value2)).filter((value2) => value2 !== null) : void 0;
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: typeof record.name === "string" ? record.name : base.name,
    systemName: typeof record.systemName === "string" ? record.systemName : typeof record.system_name === "string" ? record.system_name : base.systemName,
    colorHex: typeof record.colorHex === "string" ? record.colorHex : base.colorHex,
    colorId: action === "create" ? colorId ?? null : void 0,
    aliases: typeof record.aliases === "string" ? record.aliases : base.aliases,
    isSuccess: toBoolean(record.isSuccess, base.isSuccess ?? false),
    isFailure: toBoolean(record.isFailure, base.isFailure ?? false),
    isCompleted: toBoolean(record.isCompleted, base.isCompleted ?? false),
    isEnabled: toBoolean(record.isEnabled, base.isEnabled ?? true),
    scopeIds: action === "create" ? scopeIds ?? [] : void 0
  };
};
var normalizeGroupConfig = (value) => {
  const base = {
    action: "create",
    mappedTo: null,
    name: void 0,
    note: void 0
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "create";
  const mappedTo = toNumber(record.mappedTo);
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: typeof record.name === "string" ? record.name : base.name,
    note: typeof record.note === "string" ? record.note : base.note
  };
};
var normalizeTagConfig = (value) => {
  const base = {
    action: "create",
    mappedTo: null,
    name: void 0
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "create";
  const mappedTo = toNumber(record.mappedTo);
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: typeof record.name === "string" ? record.name : base.name
  };
};
var normalizeIssueTargetConfig = (value) => {
  const base = {
    action: "create",
    mappedTo: null,
    name: void 0,
    provider: null,
    testmoType: null
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "create";
  const mappedTo = toNumber(record.mappedTo);
  const testmoType = toNumber(record.testmoType ?? record.type);
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: typeof record.name === "string" ? record.name : base.name,
    provider: typeof record.provider === "string" ? record.provider : base.provider,
    testmoType: action === "create" ? testmoType ?? null : void 0
  };
};
var normalizeUserConfig = (value) => {
  const base = {
    action: "map",
    mappedTo: null,
    name: void 0,
    email: void 0,
    password: void 0,
    access: void 0,
    roleId: null,
    isActive: true,
    isApi: false
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "map";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "map";
  const mappedTo = typeof record.mappedTo === "string" ? record.mappedTo : null;
  const name = toStringValue(record.name);
  const email = toStringValue(record.email);
  const passwordValue = toStringValue(record.password);
  const password = typeof passwordValue === "string" && passwordValue.length > 0 ? passwordValue : null;
  const access = toAccessValue(record.access);
  const roleId = toNumber(record.roleId);
  const isActive = toBoolean(record.isActive, true);
  const isApi = toBoolean(record.isApi, false);
  return {
    action,
    mappedTo: action === "map" ? mappedTo : void 0,
    name: action === "create" ? name : void 0,
    email: action === "create" ? email : void 0,
    password: action === "create" ? password ?? generateRandomPassword() : void 0,
    access: action === "create" ? access : void 0,
    roleId: action === "create" ? roleId ?? null : void 0,
    isActive: action === "create" ? isActive : void 0,
    isApi: action === "create" ? isApi : void 0
  };
};
var normalizeStringArray = (value) => {
  if (!value) {
    return void 0;
  }
  if (Array.isArray(value)) {
    const entries = value.map((entry) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (typeof entry === "object" && entry && "name" in entry) {
        const raw = entry.name;
        if (typeof raw === "string") {
          const trimmed = raw.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
      return null;
    }).filter((entry) => entry !== null);
    return entries.length > 0 ? entries : void 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return void 0;
    }
    const segments = trimmed.split(/[\n,]+/).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
    return segments.length > 0 ? segments : void 0;
  }
  return void 0;
};
var normalizeOptionConfigList = (value) => {
  const coerceFromStringArray = (entries) => {
    if (entries.length === 0) {
      return void 0;
    }
    return entries.map((name, index) => ({
      name,
      iconId: null,
      iconColorId: null,
      isEnabled: true,
      isDefault: index === 0,
      order: index
    }));
  };
  if (!value) {
    return void 0;
  }
  if (Array.isArray(value)) {
    const normalized = [];
    let defaultAssigned = false;
    value.forEach((entry, index) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed.length === 0) {
          return;
        }
        normalized.push({
          name: trimmed,
          iconId: null,
          iconColorId: null,
          isEnabled: true,
          isDefault: !defaultAssigned && index === 0,
          order: index
        });
        defaultAssigned = defaultAssigned || index === 0;
        return;
      }
      if (!entry || typeof entry !== "object") {
        return;
      }
      const record = entry;
      const name = toStringValue(
        record.name ?? record.label ?? record.value ?? record.displayName ?? record.display_name
      ) ?? null;
      if (!name) {
        return;
      }
      const iconId = toNumber(
        record.iconId ?? record.icon_id ?? record.icon ?? record.iconID
      ) ?? null;
      const iconColorId = toNumber(
        record.iconColorId ?? record.icon_color_id ?? record.colorId ?? record.color_id ?? record.color
      ) ?? null;
      const isEnabled = toBoolean(
        record.isEnabled ?? record.enabled ?? record.is_enabled,
        true
      );
      const isDefault = toBoolean(
        record.isDefault ?? record.default ?? record.is_default ?? record.defaultOption,
        false
      );
      const order = toNumber(
        record.order ?? record.position ?? record.ordinal ?? record.index ?? record.sort
      ) ?? index;
      if (isDefault && !defaultAssigned) {
        defaultAssigned = true;
      }
      normalized.push({
        name,
        iconId,
        iconColorId,
        isEnabled,
        isDefault,
        order
      });
    });
    if (normalized.length === 0) {
      return void 0;
    }
    const sorted = normalized.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let defaultSeen = false;
    sorted.forEach((entry) => {
      if (entry.isDefault && !defaultSeen) {
        defaultSeen = true;
        return;
      }
      if (entry.isDefault && defaultSeen) {
        entry.isDefault = false;
      }
    });
    if (!defaultSeen) {
      sorted[0].isDefault = true;
    }
    return sorted.map((entry, index) => ({
      name: entry.name,
      iconId: entry.iconId ?? null,
      iconColorId: entry.iconColorId ?? null,
      isEnabled: entry.isEnabled ?? true,
      isDefault: entry.isDefault ?? false,
      order: entry.order ?? index
    }));
  }
  if (typeof value === "string") {
    const normalizedStrings = normalizeStringArray(value);
    return normalizedStrings ? coerceFromStringArray(normalizedStrings) : void 0;
  }
  return void 0;
};
var normalizeTemplateFieldTarget = (value, fallback) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "result" || normalized === "results") {
      return "result";
    }
    if (normalized === "case" || normalized === "cases") {
      return "case";
    }
  }
  return fallback;
};
var normalizeTemplateFieldConfig = (value) => {
  const base = {
    action: "create",
    targetType: "case",
    mappedTo: null,
    displayName: void 0,
    systemName: void 0,
    typeId: null,
    typeName: null,
    hint: void 0,
    isRequired: false,
    isRestricted: false,
    defaultValue: void 0,
    isChecked: void 0,
    minValue: void 0,
    maxValue: void 0,
    minIntegerValue: void 0,
    maxIntegerValue: void 0,
    initialHeight: void 0,
    dropdownOptions: void 0,
    templateName: void 0,
    order: void 0
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : base.action;
  const action = actionValue === "map" ? "map" : "create";
  const targetSource = record.targetType ?? record.target_type ?? record.fieldTarget ?? record.field_target ?? record.scope ?? record.assignment ?? record.fieldCategory ?? record.field_category;
  const targetType = normalizeTemplateFieldTarget(targetSource, base.targetType);
  const mappedTo = toNumber(record.mappedTo);
  const typeId = toNumber(record.typeId ?? record.type_id ?? record.fieldTypeId);
  const typeName = typeof record.typeName === "string" ? record.typeName : typeof record.type_name === "string" ? record.type_name : typeof record.fieldType === "string" ? record.fieldType : typeof record.field_type === "string" ? record.field_type : base.typeName;
  const dropdownOptions = normalizeOptionConfigList(
    record.dropdownOptions ?? record.dropdown_options ?? record.options ?? record.choices
  ) ?? base.dropdownOptions;
  return {
    action,
    targetType,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    displayName: typeof record.displayName === "string" ? record.displayName : typeof record.display_name === "string" ? record.display_name : typeof record.label === "string" ? record.label : base.displayName,
    systemName: typeof record.systemName === "string" ? record.systemName : typeof record.system_name === "string" ? record.system_name : typeof record.name === "string" ? record.name : base.systemName,
    typeId: typeId ?? null,
    typeName: typeName ?? null,
    hint: typeof record.hint === "string" ? record.hint : typeof record.description === "string" ? record.description : base.hint,
    isRequired: toBoolean(record.isRequired ?? record.is_required ?? base.isRequired),
    isRestricted: toBoolean(record.isRestricted ?? record.is_restricted ?? base.isRestricted),
    defaultValue: typeof record.defaultValue === "string" ? record.defaultValue : typeof record.default_value === "string" ? record.default_value : base.defaultValue,
    isChecked: typeof record.isChecked === "boolean" ? record.isChecked : base.isChecked,
    minValue: toNumber(record.minValue ?? record.min_value) ?? base.minValue,
    maxValue: toNumber(record.maxValue ?? record.max_value) ?? base.maxValue,
    minIntegerValue: toNumber(record.minIntegerValue ?? record.min_integer_value) ?? base.minIntegerValue,
    maxIntegerValue: toNumber(record.maxIntegerValue ?? record.max_integer_value) ?? base.maxIntegerValue,
    initialHeight: toNumber(record.initialHeight ?? record.initial_height) ?? base.initialHeight,
    dropdownOptions,
    templateName: typeof record.templateName === "string" ? record.templateName : typeof record.template_name === "string" ? record.template_name : base.templateName,
    order: toNumber(record.order ?? record.position ?? record.ordinal) ?? base.order
  };
};
var normalizeTemplateConfig = (value) => {
  const base = {
    action: "map",
    mappedTo: null,
    name: void 0
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : base.action;
  const action = ACTION_MAP.has(actionValue) ? actionValue : base.action;
  const mappedTo = toNumber(record.mappedTo);
  const name = typeof record.name === "string" ? record.name : base.name;
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: action === "create" ? name ?? void 0 : void 0
  };
};
var normalizeRolePermissions = (value) => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result = {};
  const assignPermission = (area, source) => {
    const perm = {
      canAddEdit: toBoolean(source.canAddEdit ?? false),
      canDelete: toBoolean(source.canDelete ?? false),
      canClose: toBoolean(source.canClose ?? false)
    };
    result[area] = perm;
  };
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (entry && typeof entry === "object") {
        const record = entry;
        const area = typeof record.area === "string" ? record.area : void 0;
        if (area) {
          assignPermission(area, record);
        }
      }
    });
    return result;
  }
  for (const [area, entry] of Object.entries(value)) {
    if (entry && typeof entry === "object") {
      assignPermission(area, entry);
    }
  }
  return result;
};
var normalizeRoleConfig = (value) => {
  const base = {
    action: "create",
    mappedTo: null,
    name: void 0,
    isDefault: false,
    permissions: {}
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "create";
  const mappedTo = toNumber(record.mappedTo);
  const permissions = normalizeRolePermissions(record.permissions);
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: typeof record.name === "string" ? record.name : base.name,
    isDefault: action === "create" ? toBoolean(record.isDefault ?? false) : void 0,
    permissions: action === "create" ? permissions : void 0
  };
};
var normalizeMilestoneTypeConfig = (value) => {
  const base = {
    action: "create",
    mappedTo: null,
    name: void 0,
    iconId: null,
    isDefault: false
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "create";
  const mappedTo = toNumber(record.mappedTo);
  const iconId = toNumber(record.iconId);
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: typeof record.name === "string" ? record.name : base.name,
    iconId: action === "create" ? iconId ?? null : void 0,
    isDefault: action === "create" ? toBoolean(record.isDefault ?? false) : void 0
  };
};
var normalizeConfigVariantConfig = (key, value) => {
  const base = {
    token: key,
    action: "create-category-variant",
    mappedVariantId: void 0,
    categoryId: void 0,
    categoryName: null,
    variantName: null
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : base.action;
  const action = CONFIG_VARIANT_ACTIONS.has(actionValue) ? actionValue : base.action;
  const token = typeof record.token === "string" ? record.token : base.token;
  const mappedVariantId = toNumber(record.mappedVariantId);
  const categoryId = toNumber(record.categoryId);
  const categoryName = typeof record.categoryName === "string" ? record.categoryName : base.categoryName;
  const variantName = typeof record.variantName === "string" ? record.variantName : base.variantName;
  return {
    token,
    action,
    mappedVariantId: action === "map-variant" ? mappedVariantId ?? null : void 0,
    categoryId: action === "create-variant-existing-category" ? categoryId ?? null : void 0,
    categoryName: action === "create-category-variant" ? categoryName : void 0,
    variantName: action === "map-variant" ? void 0 : variantName ?? token
  };
};
var normalizeConfigurationConfig = (value) => {
  const base = {
    action: "create",
    mappedTo: null,
    name: void 0,
    variants: {}
  };
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? actionValue : "create";
  const mappedTo = toNumber(record.mappedTo);
  const name = typeof record.name === "string" ? record.name : base.name;
  const variants = {};
  if (record.variants && typeof record.variants === "object") {
    for (const [variantKey, entry] of Object.entries(
      record.variants
    )) {
      const index = Number(variantKey);
      if (!Number.isFinite(index)) {
        continue;
      }
      variants[index] = normalizeConfigVariantConfig(variantKey, entry);
    }
  }
  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : void 0,
    name: action === "create" ? name : void 0,
    variants
  };
};
var normalizeMappingConfiguration = (value) => {
  const configuration = createEmptyMappingConfiguration();
  if (!value || typeof value !== "object") {
    return configuration;
  }
  const record = value;
  if (record.workflows && typeof record.workflows === "object") {
    for (const [key, entry] of Object.entries(
      record.workflows
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.workflows[id] = normalizeWorkflowConfig(entry);
    }
  }
  if (record.statuses && typeof record.statuses === "object") {
    for (const [key, entry] of Object.entries(
      record.statuses
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.statuses[id] = normalizeStatusConfig(entry);
    }
  }
  if (record.groups && typeof record.groups === "object") {
    for (const [key, entry] of Object.entries(
      record.groups
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.groups[id] = normalizeGroupConfig(entry);
    }
  }
  if (record.tags && typeof record.tags === "object") {
    for (const [key, entry] of Object.entries(
      record.tags
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.tags[id] = normalizeTagConfig(entry);
    }
  }
  if (record.issueTargets && typeof record.issueTargets === "object") {
    for (const [key, entry] of Object.entries(
      record.issueTargets
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.issueTargets[id] = normalizeIssueTargetConfig(entry);
    }
  }
  if (record.roles && typeof record.roles === "object") {
    for (const [key, entry] of Object.entries(
      record.roles
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.roles[id] = normalizeRoleConfig(entry);
    }
  }
  if (record.users && typeof record.users === "object") {
    for (const [key, entry] of Object.entries(
      record.users
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.users[id] = normalizeUserConfig(entry);
    }
  }
  if (record.configurations && typeof record.configurations === "object") {
    for (const [key, entry] of Object.entries(
      record.configurations
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.configurations[id] = normalizeConfigurationConfig(entry);
    }
  }
  if (record.templateFields && typeof record.templateFields === "object") {
    for (const [key, entry] of Object.entries(
      record.templateFields
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.templateFields[id] = normalizeTemplateFieldConfig(entry);
    }
  }
  if (record.milestoneTypes && typeof record.milestoneTypes === "object") {
    for (const [key, entry] of Object.entries(
      record.milestoneTypes
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.milestoneTypes[id] = normalizeMilestoneTypeConfig(entry);
    }
  }
  if (record.templates && typeof record.templates === "object") {
    for (const [key, entry] of Object.entries(
      record.templates
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.templates[id] = normalizeTemplateConfig(entry);
    }
  }
  if (record.customFields && typeof record.customFields === "object") {
    configuration.customFields = JSON.parse(
      JSON.stringify(record.customFields)
    );
  }
  return configuration;
};
var serializeMappingConfiguration = (configuration) => JSON.parse(JSON.stringify(configuration));

// app/constants/backend.ts
var emptyEditorContent = {
  type: "doc",
  content: [
    {
      type: "paragraph"
    }
  ]
};
var MAX_DURATION = 60 * 60 * 24 * 366 - 18 * 60 * 60;

// workers/testmoImport/helpers.ts
var toNumberValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
var toStringValue2 = (value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
};
var toBooleanValue = (value, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return fallback;
};
var toDateValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.includes("T") ? trimmed.endsWith("Z") ? trimmed : `${trimmed}Z` : `${trimmed.replace(" ", "T")}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};
var buildNumberIdMap = (entries) => {
  const map = /* @__PURE__ */ new Map();
  for (const [key, entry] of Object.entries(entries ?? {})) {
    if (!entry || entry.mappedTo === null || entry.mappedTo === void 0) {
      continue;
    }
    const sourceId = toNumberValue(key);
    const targetId = toNumberValue(entry.mappedTo);
    if (sourceId !== null && targetId !== null) {
      map.set(sourceId, targetId);
    }
  }
  return map;
};
var buildStringIdMap = (entries) => {
  const map = /* @__PURE__ */ new Map();
  for (const [key, entry] of Object.entries(entries ?? {})) {
    if (!entry || !entry.mappedTo) {
      continue;
    }
    const sourceId = toNumberValue(key);
    if (sourceId !== null) {
      map.set(sourceId, entry.mappedTo);
    }
  }
  return map;
};
var buildTemplateFieldMaps = (templateFields) => {
  const caseFields = /* @__PURE__ */ new Map();
  const resultFields = /* @__PURE__ */ new Map();
  for (const [key, entry] of Object.entries(templateFields ?? {})) {
    if (!entry || entry.mappedTo === null || entry.mappedTo === void 0) {
      continue;
    }
    const systemName = entry.systemName ?? entry.displayName ?? null;
    if (!systemName) {
      continue;
    }
    if (entry.targetType === "result") {
      resultFields.set(systemName, entry.mappedTo);
    } else {
      caseFields.set(systemName, entry.mappedTo);
    }
  }
  return { caseFields, resultFields };
};
var resolveUserId = (userIdMap, fallbackUserId, value) => {
  const numeric = toNumberValue(value);
  if (numeric !== null) {
    const mapped = userIdMap.get(numeric);
    if (mapped) {
      return mapped;
    }
  }
  return fallbackUserId;
};
var toInputJsonValue = (value) => {
  const { structuredClone } = globalThis;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

// workers/testmoImport/configurationImports.ts
var ensureWorkflowType = (value) => {
  if (value === "NOT_STARTED" || value === "IN_PROGRESS" || value === "DONE") {
    return value;
  }
  return "NOT_STARTED";
};
var ensureWorkflowScope = (value) => {
  if (value === "CASES" || value === "RUNS" || value === "SESSIONS") {
    return value;
  }
  return "CASES";
};
async function importWorkflows(tx, configuration) {
  const summary = {
    entity: "workflows",
    total: 0,
    created: 0,
    mapped: 0
  };
  for (const [key, config] of Object.entries(configuration.workflows ?? {})) {
    const workflowId = Number(key);
    if (!Number.isFinite(workflowId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Workflow ${workflowId} is configured to map but no target workflow was provided.`
        );
      }
      const existing = await tx.workflows.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing) {
        throw new Error(
          `Workflow ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Workflow ${workflowId} requires a name before it can be created.`
      );
    }
    const iconId = config.iconId ?? null;
    const colorId = config.colorId ?? null;
    if (iconId === null || colorId === null) {
      throw new Error(
        `Workflow "${name}" must include both an icon and a color before creation.`
      );
    }
    const workflowType = ensureWorkflowType(config.workflowType);
    const scope = ensureWorkflowScope(config.scope);
    const existingByName = await tx.workflows.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (existingByName) {
      config.action = "map";
      config.mappedTo = existingByName.id;
      summary.mapped += 1;
      continue;
    }
    const created = await tx.workflows.create({
      data: {
        name,
        workflowType,
        scope,
        iconId,
        colorId,
        isEnabled: true
      }
    });
    config.action = "map";
    config.mappedTo = created.id;
    summary.created += 1;
  }
  return summary;
}
async function importGroups(tx, configuration) {
  const summary = {
    entity: "groups",
    total: 0,
    created: 0,
    mapped: 0
  };
  for (const [key, config] of Object.entries(configuration.groups ?? {})) {
    const groupId = Number(key);
    if (!Number.isFinite(groupId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Group ${groupId} is configured to map but no target group was provided.`
        );
      }
      const existing2 = await tx.groups.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing2) {
        throw new Error(
          `Group ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing2.id;
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Group ${groupId} requires a name before it can be created.`
      );
    }
    const existing = await tx.groups.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }
    const created = await tx.groups.create({
      data: {
        name,
        note: (config.note ?? "").trim() || null
      }
    });
    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    config.note = created.note ?? null;
    summary.created += 1;
  }
  return summary;
}
async function importTags(tx, configuration) {
  const summary = {
    entity: "tags",
    total: 0,
    created: 0,
    mapped: 0
  };
  for (const [key, config] of Object.entries(configuration.tags ?? {})) {
    const tagId = Number(key);
    if (!Number.isFinite(tagId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Tag ${tagId} is configured to map but no target tag was provided.`
        );
      }
      const existing2 = await tx.tags.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing2) {
        throw new Error(
          `Tag ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing2.id;
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(`Tag ${tagId} requires a name before it can be created.`);
    }
    const existing = await tx.tags.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }
    const created = await tx.tags.create({
      data: {
        name
      }
    });
    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    summary.created += 1;
  }
  return summary;
}
async function importRoles(tx, configuration) {
  const summary = {
    entity: "roles",
    total: 0,
    created: 0,
    mapped: 0
  };
  for (const [key, config] of Object.entries(configuration.roles ?? {})) {
    const roleId = Number(key);
    if (!Number.isFinite(roleId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Role ${roleId} is configured to map but no target role was provided.`
        );
      }
      const existing2 = await tx.roles.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing2) {
        throw new Error(
          `Role ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing2.id;
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Role ${roleId} requires a name before it can be created.`
      );
    }
    const existing = await tx.roles.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }
    if (config.isDefault) {
      await tx.roles.updateMany({
        data: { isDefault: false },
        where: { isDefault: true }
      });
    }
    const created = await tx.roles.create({
      data: {
        name,
        isDefault: config.isDefault ?? false
      }
    });
    const permissions = config.permissions ?? {};
    const permissionEntries = Object.entries(permissions).map(
      ([area, permission]) => ({
        roleId: created.id,
        area,
        canAddEdit: permission?.canAddEdit ?? false,
        canDelete: permission?.canDelete ?? false,
        canClose: permission?.canClose ?? false
      })
    );
    if (permissionEntries.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionEntries,
        skipDuplicates: true
      });
    }
    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    summary.created += 1;
  }
  return summary;
}
async function importMilestoneTypes(tx, configuration) {
  const summary = {
    entity: "milestoneTypes",
    total: 0,
    created: 0,
    mapped: 0
  };
  for (const [key, config] of Object.entries(
    configuration.milestoneTypes ?? {}
  )) {
    const milestoneId = Number(key);
    if (!Number.isFinite(milestoneId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Milestone type ${milestoneId} is configured to map but no target type was provided.`
        );
      }
      const existing2 = await tx.milestoneTypes.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing2) {
        throw new Error(
          `Milestone type ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing2.id;
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Milestone type ${milestoneId} requires a name before it can be created.`
      );
    }
    const existing = await tx.milestoneTypes.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }
    if (config.isDefault) {
      await tx.milestoneTypes.updateMany({
        data: { isDefault: false },
        where: { isDefault: true }
      });
    }
    if (config.iconId !== null && config.iconId !== void 0) {
      const iconExists = await tx.fieldIcon.findUnique({
        where: { id: config.iconId }
      });
      if (!iconExists) {
        throw new Error(
          `Icon ${config.iconId} configured for milestone type "${name}" does not exist.`
        );
      }
    }
    const created = await tx.milestoneTypes.create({
      data: {
        name,
        iconId: config.iconId ?? null,
        isDefault: config.isDefault ?? false
      }
    });
    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    summary.created += 1;
  }
  return summary;
}
var resolveConfigurationVariants = async (tx, mapping) => {
  const variantIds = [];
  let createdCount = 0;
  for (const [tokenIndex, variantConfig] of Object.entries(
    mapping.variants ?? {}
  )) {
    const index = Number(tokenIndex);
    if (!Number.isFinite(index) || !variantConfig) {
      continue;
    }
    const entry = variantConfig;
    if (entry.action === "map-variant") {
      if (entry.mappedVariantId === null || entry.mappedVariantId === void 0) {
        throw new Error(
          `Configuration variant ${entry.token} is configured to map but no variant was selected.`
        );
      }
      const existing = await tx.configVariants.findUnique({
        where: { id: entry.mappedVariantId },
        include: { category: true }
      });
      if (!existing) {
        throw new Error(
          `Configuration variant ${entry.mappedVariantId} selected for mapping was not found.`
        );
      }
      entry.mappedVariantId = existing.id;
      entry.categoryId = existing.categoryId;
      entry.categoryName = existing.category.name;
      entry.variantName = existing.name;
      variantIds.push(existing.id);
      continue;
    }
    if (entry.action === "create-variant-existing-category") {
      if (entry.categoryId === null || entry.categoryId === void 0) {
        throw new Error(
          `Configuration variant ${entry.token} requires a category to be selected before creation.`
        );
      }
      const category = await tx.configCategories.findUnique({
        where: { id: entry.categoryId }
      });
      if (!category) {
        throw new Error(
          `Configuration category ${entry.categoryId} associated with variant ${entry.token} was not found.`
        );
      }
      const variantName = (entry.variantName ?? entry.token).trim();
      if (!variantName) {
        throw new Error(
          `Configuration variant ${entry.token} requires a name before it can be created.`
        );
      }
      const existingVariant = await tx.configVariants.findFirst({
        where: {
          categoryId: category.id,
          name: variantName,
          isDeleted: false
        }
      });
      if (existingVariant) {
        entry.action = "map-variant";
        entry.mappedVariantId = existingVariant.id;
        entry.categoryId = category.id;
        entry.categoryName = category.name;
        entry.variantName = existingVariant.name;
        variantIds.push(existingVariant.id);
        continue;
      }
      const createdVariant = await tx.configVariants.create({
        data: {
          name: variantName,
          categoryId: category.id
        }
      });
      entry.action = "map-variant";
      entry.mappedVariantId = createdVariant.id;
      entry.categoryId = category.id;
      entry.categoryName = category.name;
      entry.variantName = createdVariant.name;
      variantIds.push(createdVariant.id);
      createdCount += 1;
      continue;
    }
    if (entry.action === "create-category-variant") {
      const categoryName = (entry.categoryName ?? entry.token).trim();
      const variantName = (entry.variantName ?? entry.token).trim();
      if (!categoryName) {
        throw new Error(
          `Configuration variant ${entry.token} requires a category name before it can be created.`
        );
      }
      if (!variantName) {
        throw new Error(
          `Configuration variant ${entry.token} requires a variant name before it can be created.`
        );
      }
      let category = await tx.configCategories.findFirst({
        where: { name: categoryName, isDeleted: false }
      });
      if (!category) {
        category = await tx.configCategories.create({
          data: { name: categoryName }
        });
      }
      let variant = await tx.configVariants.findFirst({
        where: {
          categoryId: category.id,
          name: variantName,
          isDeleted: false
        }
      });
      if (!variant) {
        variant = await tx.configVariants.create({
          data: {
            name: variantName,
            categoryId: category.id
          }
        });
        createdCount += 1;
      }
      entry.action = "map-variant";
      entry.mappedVariantId = variant.id;
      entry.categoryId = category.id;
      entry.categoryName = category.name;
      entry.variantName = variant.name;
      variantIds.push(variant.id);
      continue;
    }
    throw new Error(
      `Unsupported configuration variant action "${entry.action}" for token ${entry.token}.`
    );
  }
  return { variantIds: Array.from(new Set(variantIds)), createdCount };
};
async function importConfigurations(tx, configuration) {
  const summary = {
    entity: "configurations",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      variantsCreated: 0
    }
  };
  for (const [key, configEntry] of Object.entries(
    configuration.configurations ?? {}
  )) {
    const configId = Number(key);
    if (!Number.isFinite(configId) || !configEntry) {
      continue;
    }
    summary.total += 1;
    const entry = configEntry;
    if (entry.action === "map") {
      if (entry.mappedTo === null || entry.mappedTo === void 0) {
        throw new Error(
          `Configuration ${configId} is configured to map but no target configuration was provided.`
        );
      }
      const existing = await tx.configurations.findUnique({
        where: { id: entry.mappedTo }
      });
      if (!existing) {
        throw new Error(
          `Configuration ${entry.mappedTo} selected for mapping was not found.`
        );
      }
      entry.mappedTo = existing.id;
      const { variantIds: variantIds2, createdCount: createdCount2 } = await resolveConfigurationVariants(
        tx,
        entry
      );
      if (variantIds2.length > 0) {
        await tx.configurationConfigVariant.createMany({
          data: variantIds2.map((variantId) => ({
            configurationId: existing.id,
            variantId
          })),
          skipDuplicates: true
        });
      }
      summary.details.variantsCreated = summary.details.variantsCreated + createdCount2;
      summary.mapped += 1;
      continue;
    }
    const name = (entry.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Configuration ${configId} requires a name before it can be created.`
      );
    }
    let configurationRecord = await tx.configurations.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (!configurationRecord) {
      configurationRecord = await tx.configurations.create({ data: { name } });
      summary.created += 1;
    } else {
      summary.mapped += 1;
    }
    entry.action = "map";
    entry.mappedTo = configurationRecord.id;
    entry.name = configurationRecord.name;
    const { variantIds, createdCount } = await resolveConfigurationVariants(
      tx,
      entry
    );
    if (variantIds.length > 0) {
      await tx.configurationConfigVariant.createMany({
        data: variantIds.map((variantId) => ({
          configurationId: configurationRecord.id,
          variantId
        })),
        skipDuplicates: true
      });
    }
    summary.details.variantsCreated = summary.details.variantsCreated + createdCount;
  }
  return summary;
}
async function importUserGroups(tx, configuration, datasetRows) {
  const summary = {
    entity: "userGroups",
    total: 0,
    created: 0,
    mapped: 0
  };
  const userGroupRows = datasetRows.get("user_groups") ?? [];
  for (const row of userGroupRows) {
    summary.total += 1;
    const testmoUserId = toNumberValue(row.user_id);
    const testmoGroupId = toNumberValue(row.group_id);
    if (!testmoUserId || !testmoGroupId) {
      continue;
    }
    const userConfig = configuration.users?.[testmoUserId];
    if (!userConfig || userConfig.action !== "map" || !userConfig.mappedTo) {
      continue;
    }
    const groupConfig = configuration.groups?.[testmoGroupId];
    if (!groupConfig || groupConfig.action !== "map" || !groupConfig.mappedTo) {
      continue;
    }
    const userId = userConfig.mappedTo;
    const groupId = groupConfig.mappedTo;
    const existing = await tx.groupAssignment.findUnique({
      where: {
        userId_groupId: {
          userId,
          groupId
        }
      }
    });
    if (existing) {
      summary.mapped += 1;
      continue;
    }
    await tx.groupAssignment.create({
      data: {
        userId,
        groupId
      }
    });
    summary.created += 1;
  }
  return summary;
}

// workers/testmoImport/automationImports.ts
var import_client2 = require("@prisma/client");
var projectNameCache = /* @__PURE__ */ new Map();
var templateNameCache = /* @__PURE__ */ new Map();
var workflowNameCache = /* @__PURE__ */ new Map();
var folderNameCache = /* @__PURE__ */ new Map();
var userNameCache = /* @__PURE__ */ new Map();
var chunkArray = (items, chunkSize) => {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0");
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};
async function getProjectName(tx, projectId) {
  if (projectNameCache.has(projectId)) {
    return projectNameCache.get(projectId);
  }
  const project = await tx.projects.findUnique({
    where: { id: projectId },
    select: { name: true }
  });
  const name = project?.name ?? `Project ${projectId}`;
  projectNameCache.set(projectId, name);
  return name;
}
async function getTemplateName(tx, templateId) {
  if (templateNameCache.has(templateId)) {
    return templateNameCache.get(templateId);
  }
  const template = await tx.templates.findUnique({
    where: { id: templateId },
    select: { templateName: true }
  });
  const name = template?.templateName ?? `Template ${templateId}`;
  templateNameCache.set(templateId, name);
  return name;
}
async function getWorkflowName(tx, workflowId) {
  if (workflowNameCache.has(workflowId)) {
    return workflowNameCache.get(workflowId);
  }
  const workflow = await tx.workflows.findUnique({
    where: { id: workflowId },
    select: { name: true }
  });
  const name = workflow?.name ?? `Workflow ${workflowId}`;
  workflowNameCache.set(workflowId, name);
  return name;
}
async function getFolderName(tx, folderId) {
  if (folderNameCache.has(folderId)) {
    return folderNameCache.get(folderId);
  }
  const folder = await tx.repositoryFolders.findUnique({
    where: { id: folderId },
    select: { name: true }
  });
  const name = folder?.name ?? "";
  folderNameCache.set(folderId, name);
  return name;
}
async function getUserName(tx, userId) {
  if (!userId) {
    return "Automation Import";
  }
  if (userNameCache.has(userId)) {
    return userNameCache.get(userId);
  }
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true }
  });
  const name = user?.name ?? userId;
  userNameCache.set(userId, name);
  return name;
}
var looksLikeGeneratedIdentifier = (segment) => {
  const lower = segment.toLowerCase();
  if (/^[0-9a-f-]{8,}$/i.test(segment)) {
    return true;
  }
  if (/^\d{6,}$/.test(segment)) {
    return true;
  }
  if (segment.includes(":")) {
    return true;
  }
  if (segment.startsWith("@")) {
    return true;
  }
  if (segment === lower && /[0-9]/.test(segment) && /^[a-z0-9_-]{6,}$/.test(segment)) {
    return true;
  }
  return false;
};
var normalizeAutomationClassName = (folder) => {
  if (!folder) {
    return null;
  }
  const segments = folder.split(".").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  const filteredSegments = segments.filter((segment, index) => {
    if (index === 0) {
      return true;
    }
    return !looksLikeGeneratedIdentifier(segment);
  });
  if (filteredSegments.length === 0) {
    return segments[segments.length - 1] ?? null;
  }
  return filteredSegments.join(".");
};
var importAutomationCases = async (prisma2, configuration, datasetRows, projectIdMap, repositoryIdMap, _folderIdMap, templateIdMap, projectDefaultTemplateMap, workflowIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "automationCases",
    total: 0,
    created: 0,
    mapped: 0
  };
  const automationCaseIdMap = /* @__PURE__ */ new Map();
  const automationCaseProjectMap = /* @__PURE__ */ new Map();
  const automationCaseRows = datasetRows.get("automation_cases") ?? [];
  const globalFallbackTemplateId = Array.from(templateIdMap.values())[0] ?? null;
  summary.total = automationCaseRows.length;
  const entityName = "automationCases";
  const progressEntry = context.entityProgress[entityName] ?? (context.entityProgress[entityName] = {
    total: summary.total,
    created: 0,
    mapped: 0
  });
  progressEntry.total = summary.total;
  let processedAutomationCases = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2e3;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedAutomationCases - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(
      processedAutomationCases,
      progressEntry.total
    );
    lastReportedCount = processedAutomationCases;
    lastReportAt = now;
    const statusMessage = `Processing automation case imports (${processedAutomationCases.toLocaleString()} / ${summary.total.toLocaleString()} cases processed)`;
    await persistProgress(entityName, statusMessage);
  };
  const repositoryCaseGroupMap = /* @__PURE__ */ new Map();
  for (const row of automationCaseRows) {
    const testmoCaseId = toNumberValue(row.id);
    const testmoProjectId = toNumberValue(row.project_id);
    if (!testmoCaseId || !testmoProjectId) {
      continue;
    }
    const projectId = projectIdMap.get(testmoProjectId);
    if (!projectId) {
      continue;
    }
    const name = toStringValue2(row.name) || `Automation Case ${testmoCaseId}`;
    const folder = toStringValue2(row.folder);
    const createdAt = toDateValue(row.created_at);
    const className = normalizeAutomationClassName(folder);
    const repoKey = `${projectId}|${name}|${className ?? "null"}`;
    if (!repositoryCaseGroupMap.has(repoKey)) {
      repositoryCaseGroupMap.set(repoKey, {
        name,
        className,
        projectId,
        testmoCaseIds: [],
        folder,
        createdAt
      });
    }
    const group = repositoryCaseGroupMap.get(repoKey);
    group.testmoCaseIds.push(testmoCaseId);
    if (group.testmoCaseIds.length === 2) {
      console.log(
        `[CASE_GROUPING] Multiple Testmo cases mapping to same repo case:`
      );
      console.log(`  Key: ${repoKey}`);
      console.log(`  TestPlanIt projectId: ${projectId}`);
      console.log(`  Name: ${name}`);
      console.log(`  ClassName: ${className}`);
      console.log(`  Testmo case IDs: ${group.testmoCaseIds.join(", ")}`);
    } else if (group.testmoCaseIds.length > 2) {
      console.log(
        `[CASE_GROUPING] Adding case ${testmoCaseId} to group (now ${group.testmoCaseIds.length} cases): ${group.testmoCaseIds.join(", ")}`
      );
    }
  }
  const repositoryCaseGroups = Array.from(repositoryCaseGroupMap.values());
  if (repositoryCaseGroups.length === 0) {
    await reportProgress(true);
    return { summary, automationCaseIdMap, automationCaseProjectMap };
  }
  await prisma2.$executeRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"RepositoryCases"', 'id'),
      COALESCE((SELECT MAX(id) FROM "RepositoryCases"), 1),
      true
    );
  `);
  for (let index = 0; index < repositoryCaseGroups.length; index += chunkSize) {
    const chunk = repositoryCaseGroups.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const group of chunk) {
          const {
            name,
            className,
            projectId,
            testmoCaseIds,
            folder,
            createdAt
          } = group;
          const processedForGroup = testmoCaseIds.length;
          let repositoryId;
          for (const [, mappedRepoId] of repositoryIdMap.entries()) {
            const repoCheck = await tx.repositories.findFirst({
              where: { id: mappedRepoId, projectId }
            });
            if (repoCheck) {
              repositoryId = mappedRepoId;
              break;
            }
          }
          if (!repositoryId) {
            let repository = await tx.repositories.findFirst({
              where: {
                projectId,
                isActive: true,
                isDeleted: false,
                isArchived: false
              },
              orderBy: { id: "asc" }
            });
            if (!repository) {
              repository = await tx.repositories.create({
                data: {
                  projectId,
                  isActive: true,
                  isDeleted: false,
                  isArchived: false
                }
              });
            }
            repositoryId = repository.id;
          }
          let folderId;
          let folderNameForVersion = null;
          let automationRootFolder = await tx.repositoryFolders.findFirst({
            where: {
              projectId,
              repositoryId,
              parentId: null,
              name: "Automation",
              isDeleted: false
            }
          });
          if (!automationRootFolder) {
            automationRootFolder = await tx.repositoryFolders.create({
              data: {
                projectId,
                repositoryId,
                parentId: null,
                name: "Automation",
                creatorId: configuration.users?.[1]?.mappedTo || "unknown"
              }
            });
          }
          let currentParentId = automationRootFolder.id;
          if (folder) {
            const folderParts = folder.split(".");
            for (const folderName of folderParts) {
              if (!folderName) continue;
              const existing = await tx.repositoryFolders.findFirst({
                where: {
                  projectId,
                  repositoryId,
                  parentId: currentParentId,
                  name: folderName,
                  isDeleted: false
                }
              });
              const current = existing || await tx.repositoryFolders.create({
                data: {
                  projectId,
                  repositoryId,
                  parentId: currentParentId,
                  name: folderName,
                  creatorId: configuration.users?.[1]?.mappedTo || "unknown"
                }
              });
              currentParentId = current.id;
              folderId = current.id;
            }
            if (folderParts.length > 0) {
              folderNameForVersion = folderParts[folderParts.length - 1] || null;
            }
          }
          if (!folderId) {
            folderId = automationRootFolder.id;
            folderNameForVersion = "Automation";
          }
          let defaultTemplateId = projectDefaultTemplateMap.get(projectId) ?? null;
          if (!defaultTemplateId) {
            const fallbackAssignment = await tx.templateProjectAssignment.findFirst({
              where: { projectId },
              select: { templateId: true },
              orderBy: { templateId: "asc" }
            });
            defaultTemplateId = fallbackAssignment?.templateId ?? null;
          }
          if (!defaultTemplateId) {
            defaultTemplateId = globalFallbackTemplateId;
          }
          if (!defaultTemplateId) {
            processedAutomationCases += processedForGroup;
            context.processedCount += processedForGroup;
            continue;
          }
          const resolvedTemplateId = defaultTemplateId;
          const defaultWorkflowId = Array.from(workflowIdMap.values()).find((id) => id !== void 0) || 1;
          const normalizedClassName = className || null;
          let repositoryCase = await tx.repositoryCases.findFirst({
            where: {
              projectId,
              name,
              className: normalizedClassName,
              source: "JUNIT",
              isDeleted: false
            }
          });
          if (!repositoryCase && normalizedClassName) {
            repositoryCase = await tx.repositoryCases.findFirst({
              where: {
                projectId,
                name,
                source: "JUNIT",
                isDeleted: false
              }
            });
          }
          if (repositoryCase) {
            if (normalizedClassName && repositoryCase.className !== normalizedClassName) {
              repositoryCase = await tx.repositoryCases.update({
                where: { id: repositoryCase.id },
                data: {
                  className: normalizedClassName
                }
              });
            }
            repositoryCase = await tx.repositoryCases.update({
              where: { id: repositoryCase.id },
              data: {
                automated: true,
                isDeleted: false,
                isArchived: false,
                stateId: defaultWorkflowId,
                templateId: resolvedTemplateId,
                folderId,
                repositoryId
              }
            });
            for (const testmoCaseId of testmoCaseIds) {
              automationCaseIdMap.set(testmoCaseId, repositoryCase.id);
              let projectMap = automationCaseProjectMap.get(projectId);
              if (!projectMap) {
                projectMap = /* @__PURE__ */ new Map();
                automationCaseProjectMap.set(projectId, projectMap);
              }
              projectMap.set(testmoCaseId, repositoryCase.id);
            }
            summary.mapped += testmoCaseIds.length;
          } else {
            repositoryCase = await tx.repositoryCases.create({
              data: {
                projectId,
                repositoryId,
                folderId,
                name,
                className: normalizedClassName,
                source: "JUNIT",
                automated: true,
                stateId: defaultWorkflowId,
                templateId: resolvedTemplateId,
                creatorId: configuration.users?.[1]?.mappedTo || "unknown",
                createdAt: createdAt || /* @__PURE__ */ new Date()
              }
            });
            for (const testmoCaseId of testmoCaseIds) {
              automationCaseIdMap.set(testmoCaseId, repositoryCase.id);
              let projectMap = automationCaseProjectMap.get(projectId);
              if (!projectMap) {
                projectMap = /* @__PURE__ */ new Map();
                automationCaseProjectMap.set(projectId, projectMap);
              }
              projectMap.set(testmoCaseId, repositoryCase.id);
            }
            summary.created += 1;
            const projectName = await getProjectName(tx, projectId);
            const templateName = await getTemplateName(tx, resolvedTemplateId);
            const workflowName = await getWorkflowName(tx, defaultWorkflowId);
            const resolvedFolderName = folderNameForVersion ?? await getFolderName(tx, folderId);
            const creatorName = await getUserName(tx, repositoryCase.creatorId);
            const caseVersion = await tx.repositoryCaseVersions.create({
              data: {
                repositoryCase: { connect: { id: repositoryCase.id } },
                project: { connect: { id: projectId } },
                staticProjectId: projectId,
                staticProjectName: projectName,
                repositoryId,
                folderId,
                folderName: resolvedFolderName ?? "",
                templateId: resolvedTemplateId,
                templateName,
                name,
                stateId: defaultWorkflowId,
                stateName: workflowName,
                estimate: repositoryCase.estimate ?? null,
                forecastManual: null,
                forecastAutomated: null,
                order: repositoryCase.order ?? 0,
                createdAt: repositoryCase.createdAt ?? /* @__PURE__ */ new Date(),
                creatorId: repositoryCase.creatorId,
                creatorName,
                automated: true,
                isArchived: repositoryCase.isArchived,
                isDeleted: repositoryCase.isDeleted,
                version: repositoryCase.currentVersion,
                steps: import_client2.Prisma.JsonNull,
                tags: [],
                issues: [],
                links: [],
                attachments: []
              }
            });
            const caseFieldValues = await tx.caseFieldValues.findMany({
              where: { testCaseId: repositoryCase.id },
              include: {
                field: {
                  select: {
                    displayName: true,
                    systemName: true
                  }
                }
              }
            });
            if (caseFieldValues.length > 0) {
              await tx.caseFieldVersionValues.createMany({
                data: caseFieldValues.map((fieldValue) => ({
                  versionId: caseVersion.id,
                  field: fieldValue.field.displayName || fieldValue.field.systemName,
                  value: fieldValue.value ?? import_client2.Prisma.JsonNull
                }))
              });
            }
          }
          processedAutomationCases += processedForGroup;
          context.processedCount += processedForGroup;
          progressEntry.created = summary.created;
          progressEntry.mapped = Math.min(
            processedAutomationCases,
            progressEntry.total
          );
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    await reportProgress(true);
  }
  progressEntry.created = summary.created;
  progressEntry.mapped = summary.mapped;
  return { summary, automationCaseIdMap, automationCaseProjectMap };
};
var importAutomationRuns = async (prisma2, _configuration, datasetRows, projectIdMap, configurationIdMap, milestoneIdMap, workflowIdMap, userIdMap, defaultUserId, context, persistProgress, options) => {
  const summary = {
    entity: "automationRuns",
    total: 0,
    created: 0,
    mapped: 0
  };
  const testRunIdMap = /* @__PURE__ */ new Map();
  const testSuiteIdMap = /* @__PURE__ */ new Map();
  const testRunTimestampMap = /* @__PURE__ */ new Map();
  const testRunProjectIdMap = /* @__PURE__ */ new Map();
  const testRunTestmoProjectIdMap = /* @__PURE__ */ new Map();
  const automationRunRows = datasetRows.get("automation_runs") ?? [];
  summary.total = automationRunRows.length;
  const entityName = "automationRuns";
  const progressEntry = context.entityProgress[entityName] ?? (context.entityProgress[entityName] = {
    total: summary.total,
    created: 0,
    mapped: 0
  });
  progressEntry.total = summary.total;
  let processedRuns = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2e3;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedRuns - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRuns, progressEntry.total);
    lastReportedCount = processedRuns;
    lastReportAt = now;
    const statusMessage = `Processing automation run imports (${processedRuns.toLocaleString()} / ${summary.total.toLocaleString()} runs processed)`;
    await persistProgress(entityName, statusMessage);
  };
  if (automationRunRows.length === 0) {
    await reportProgress(true);
    return {
      summary,
      testRunIdMap,
      testSuiteIdMap,
      testRunTimestampMap,
      testRunProjectIdMap,
      testRunTestmoProjectIdMap
    };
  }
  const defaultWorkflowId = Array.from(workflowIdMap.values()).find((id) => id !== void 0) || 1;
  for (let index = 0; index < automationRunRows.length; index += chunkSize) {
    const chunk = automationRunRows.slice(index, index + chunkSize);
    let processedInChunk = 0;
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const testmoRunId = toNumberValue(row.id);
          const testmoProjectId = toNumberValue(row.project_id);
          const testmoConfigId = toNumberValue(row.config_id);
          const testmoMilestoneId = toNumberValue(row.milestone_id);
          const testmoCreatedBy = toNumberValue(row.created_by);
          processedInChunk += 1;
          if (!testmoRunId || !testmoProjectId) {
            continue;
          }
          const projectId = projectIdMap.get(testmoProjectId);
          if (!projectId) {
            continue;
          }
          const name = toStringValue2(row.name) || `Automation Run ${testmoRunId}`;
          const configId = testmoConfigId ? configurationIdMap.get(testmoConfigId) : void 0;
          const milestoneId = testmoMilestoneId ? milestoneIdMap.get(testmoMilestoneId) : void 0;
          const createdById = resolveUserId(
            userIdMap,
            defaultUserId,
            testmoCreatedBy
          );
          const createdAt = toDateValue(row.created_at);
          const completedAt = toDateValue(row.completed_at);
          const elapsedMicroseconds = toNumberValue(row.elapsed);
          const totalCount = toNumberValue(row.total_count) || 0;
          const testmoIsCompleted = row.is_completed !== void 0 ? toBooleanValue(row.is_completed) : true;
          const elapsed = elapsedMicroseconds ? Math.round(elapsedMicroseconds / 1e6) : null;
          const resolvedCompletedAt = completedAt || (testmoIsCompleted ? createdAt || /* @__PURE__ */ new Date() : null);
          const testRun = await tx.testRuns.create({
            data: {
              name,
              projectId,
              stateId: defaultWorkflowId,
              configId: configId || null,
              milestoneId: milestoneId || null,
              testRunType: "JUNIT",
              createdById,
              createdAt: createdAt || /* @__PURE__ */ new Date(),
              completedAt: resolvedCompletedAt || null,
              isCompleted: testmoIsCompleted,
              elapsed
            }
          });
          const testSuite = await tx.jUnitTestSuite.create({
            data: {
              name,
              time: elapsed || 0,
              tests: totalCount,
              testRunId: testRun.id,
              createdById,
              timestamp: createdAt || /* @__PURE__ */ new Date()
            }
          });
          testRunIdMap.set(testmoRunId, testRun.id);
          testSuiteIdMap.set(testmoRunId, testSuite.id);
          testRunTimestampMap.set(
            testmoRunId,
            resolvedCompletedAt || createdAt || /* @__PURE__ */ new Date()
          );
          testRunProjectIdMap.set(testmoRunId, projectId);
          testRunTestmoProjectIdMap.set(testmoRunId, testmoProjectId);
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    processedRuns += processedInChunk;
    context.processedCount += processedInChunk;
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRuns, progressEntry.total);
    await reportProgress(true);
  }
  await reportProgress(true);
  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRuns, progressEntry.total);
  return {
    summary,
    testRunIdMap,
    testSuiteIdMap,
    testRunTimestampMap,
    testRunProjectIdMap,
    testRunTestmoProjectIdMap
  };
};
var importAutomationRunTests = async (prisma2, _configuration, datasetRows, projectIdMap, testRunIdMap, testSuiteIdMap, testRunTimestampMap, testRunProjectIdMap, testRunTestmoProjectIdMap, automationCaseProjectMap, statusIdMap, _userIdMap, defaultUserId, context, persistProgress, options) => {
  const summary = {
    entity: "automationRunTests",
    total: 0,
    created: 0,
    mapped: 0
  };
  const testRunCaseIdMap = /* @__PURE__ */ new Map();
  const junitResultIdMap = /* @__PURE__ */ new Map();
  const automationRunTestRows = datasetRows.get("automation_run_tests") ?? [];
  summary.total = automationRunTestRows.length;
  const statusCache = /* @__PURE__ */ new Map();
  const fetchStatusById = async (tx, statusId) => {
    if (statusCache.has(statusId)) {
      return statusCache.get(statusId);
    }
    const status = await tx.status.findUnique({
      where: { id: statusId },
      select: {
        id: true,
        name: true,
        systemName: true,
        aliases: true,
        isSuccess: true,
        isFailure: true,
        isCompleted: true
      }
    });
    if (status) {
      statusCache.set(statusId, status);
    }
    return status ?? null;
  };
  const determineJUnitResultType = (resolvedStatus, rawStatusName) => {
    const candidates = /* @__PURE__ */ new Set();
    const pushCandidate = (value) => {
      if (!value) {
        return;
      }
      const normalized = value.trim().toLowerCase();
      if (normalized.length > 0) {
        candidates.add(normalized);
      }
    };
    pushCandidate(rawStatusName);
    pushCandidate(resolvedStatus?.systemName);
    pushCandidate(resolvedStatus?.name);
    if (resolvedStatus?.aliases) {
      resolvedStatus.aliases.split(",").map((alias) => alias.trim()).forEach((alias) => pushCandidate(alias));
    }
    const hasCandidateIncluding = (...needles) => {
      for (const candidate of candidates) {
        for (const needle of needles) {
          if (candidate.includes(needle)) {
            return true;
          }
        }
      }
      return false;
    };
    if (hasCandidateIncluding("skip", "skipped", "block", "blocked", "omit")) {
      return import_client2.JUnitResultType.SKIPPED;
    }
    if (hasCandidateIncluding("error", "exception")) {
      return import_client2.JUnitResultType.ERROR;
    }
    if (resolvedStatus?.isFailure || hasCandidateIncluding("fail", "failed")) {
      return import_client2.JUnitResultType.FAILURE;
    }
    if (resolvedStatus?.isSuccess) {
      return import_client2.JUnitResultType.PASSED;
    }
    return import_client2.JUnitResultType.PASSED;
  };
  const entityName = "automationRunTests";
  const progressEntry = context.entityProgress[entityName] ?? (context.entityProgress[entityName] = {
    total: summary.total,
    created: 0,
    mapped: 0
  });
  progressEntry.total = summary.total;
  let processedTests = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2e3;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedTests - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedTests, progressEntry.total);
    lastReportedCount = processedTests;
    lastReportAt = now;
    const statusMessage = `Processing automation run test imports (${processedTests.toLocaleString()} / ${summary.total.toLocaleString()} tests processed)`;
    await persistProgress(entityName, statusMessage);
  };
  if (automationRunTestRows.length === 0) {
    await reportProgress(true);
    return { summary, testRunCaseIdMap, junitResultIdMap };
  }
  const findAutomationStatus = async (tx, testmoStatusId, projectId, statusName) => {
    if (testmoStatusId && statusIdMap.has(testmoStatusId)) {
      const mappedStatusId = statusIdMap.get(testmoStatusId);
      if (mappedStatusId) {
        const mappedStatus = await fetchStatusById(tx, mappedStatusId);
        if (mappedStatus) {
          return mappedStatus;
        }
      }
    }
    const select = {
      id: true,
      name: true,
      systemName: true,
      aliases: true,
      isSuccess: true,
      isFailure: true,
      isCompleted: true
    };
    if (statusName) {
      const normalizedStatus = statusName.toLowerCase();
      const status = await tx.status.findFirst({
        select,
        where: {
          isEnabled: true,
          isDeleted: false,
          projects: { some: { projectId } },
          scope: { some: { scope: { name: "Automation" } } },
          OR: [
            {
              systemName: {
                equals: normalizedStatus,
                mode: "insensitive"
              }
            },
            { aliases: { contains: normalizedStatus } }
          ]
        }
      });
      if (status) {
        statusCache.set(status.id, status);
        return status;
      }
    }
    const untestedStatus = await tx.status.findFirst({
      select,
      where: {
        isEnabled: true,
        isDeleted: false,
        systemName: { equals: "untested", mode: "insensitive" },
        projects: { some: { projectId } },
        scope: { some: { scope: { name: "Automation" } } }
      }
    });
    if (untestedStatus) {
      statusCache.set(untestedStatus.id, untestedStatus);
    }
    return untestedStatus ?? null;
  };
  for (let index = 0; index < automationRunTestRows.length; index += chunkSize) {
    const chunk = automationRunTestRows.slice(index, index + chunkSize);
    let processedInChunk = 0;
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const testmoRunTestId = toNumberValue(row.id);
          const testmoRunId = toNumberValue(row.run_id);
          const testmoProjectId = toNumberValue(row.project_id);
          const testmoCaseId = toNumberValue(row.case_id);
          const testmoStatusId = toNumberValue(row.status_id);
          processedInChunk += 1;
          if (!testmoRunTestId || !testmoRunId || !testmoProjectId) {
            continue;
          }
          if (junitResultIdMap.has(testmoRunTestId)) {
            continue;
          }
          const testRunId = testRunIdMap.get(testmoRunId);
          const testSuiteId = testSuiteIdMap.get(testmoRunId);
          const testRunProjectId = testRunProjectIdMap.get(testmoRunId);
          const testRunTestmoProjectId = testRunTestmoProjectIdMap.get(testmoRunId);
          let actualTestRunProjectId = testRunProjectId;
          if (!actualTestRunProjectId && testRunId) {
            const existingRun = await tx.testRuns.findUnique({
              where: { id: testRunId },
              select: { projectId: true }
            });
            actualTestRunProjectId = existingRun?.projectId;
          }
          let repositoryCaseId;
          let actualCaseProjectId;
          if (testmoCaseId) {
            for (const [
              projectId,
              caseMap
            ] of automationCaseProjectMap.entries()) {
              if (typeof caseMap.get === "function") {
                const caseId = caseMap.get(
                  testmoCaseId
                );
                if (caseId) {
                  repositoryCaseId = caseId;
                  actualCaseProjectId = projectId;
                  if (summary.created < 5) {
                    console.log(
                      `[FOUND_IN_MAP] testmoCaseId=${testmoCaseId} \u2192 caseId=${caseId}, project=${projectId}, runProject=${actualTestRunProjectId}`
                    );
                  }
                  break;
                }
              }
            }
          }
          if (!repositoryCaseId && testmoCaseId && actualTestRunProjectId) {
            const testName = toStringValue2(row.name);
            if (testName) {
              const existingCase = await tx.repositoryCases.findFirst({
                where: {
                  projectId: actualTestRunProjectId,
                  // CRITICAL: Only search in run's project
                  name: testName,
                  source: "JUNIT"
                },
                select: { id: true, projectId: true }
              });
              if (existingCase) {
                repositoryCaseId = existingCase.id;
                actualCaseProjectId = existingCase.projectId;
                if (summary.created < 5) {
                  console.log(
                    `[FALLBACK] testmoCaseId=${testmoCaseId}, name=${testName.substring(0, 50)} \u2192 caseId=${repositoryCaseId}, project=${actualCaseProjectId}, runProject=${actualTestRunProjectId}`
                  );
                }
              }
            }
          }
          if (summary.created < 20) {
            console.log(
              `[DEBUG #${summary.created}] testmoRunId=${testmoRunId}, testmoCaseId=${testmoCaseId}`
            );
            console.log(
              `  testRunId=${testRunId}, testSuiteId=${testSuiteId}, repositoryCaseId=${repositoryCaseId}`
            );
            console.log(
              `  actualTestRunProjectId=${actualTestRunProjectId}, actualCaseProjectId=${actualCaseProjectId}`
            );
            console.log(
              `  testRunProjectId from map=${testRunProjectIdMap.get(testmoRunId)}`
            );
          }
          if (!testRunId || !testSuiteId || !repositoryCaseId || !actualTestRunProjectId || !actualCaseProjectId) {
            if (summary.created < 10) {
              console.log(
                `[SKIP-MISSING] Missing IDs: testRunId=${testRunId}, testSuiteId=${testSuiteId}, repositoryCaseId=${repositoryCaseId}, actualTestRunProjectId=${actualTestRunProjectId}, actualCaseProjectId=${actualCaseProjectId}`
              );
            }
            continue;
          }
          const caseProjectNum = Number(actualCaseProjectId);
          const runProjectNum = Number(actualTestRunProjectId);
          if (caseProjectNum !== runProjectNum) {
            console.log(
              `[SKIP] Cross-project test #${summary.created}: testmoCaseId=${testmoCaseId}, testmoRunId=${testmoRunId}, caseProject=${caseProjectNum} (type: ${typeof actualCaseProjectId}), runProject=${runProjectNum} (type: ${typeof actualTestRunProjectId})`
            );
            continue;
          }
          const statusName = toStringValue2(row.status);
          const elapsedMicroseconds = toNumberValue(row.elapsed);
          const file = toStringValue2(row.file);
          const line = toStringValue2(row.line);
          const assertions = toNumberValue(row.assertions);
          const elapsed = elapsedMicroseconds ? Math.round(elapsedMicroseconds / 1e6) : null;
          const resolvedStatus = await findAutomationStatus(
            tx,
            testmoStatusId,
            actualTestRunProjectId,
            statusName
          );
          const statusId = resolvedStatus?.id ?? null;
          const testRunCase = await tx.testRunCases.upsert({
            where: {
              testRunId_repositoryCaseId: {
                testRunId,
                repositoryCaseId
              }
            },
            update: {
              statusId: statusId ?? void 0,
              elapsed,
              isCompleted: !!statusId,
              completedAt: statusId ? /* @__PURE__ */ new Date() : null
            },
            create: {
              testRunId,
              repositoryCaseId,
              statusId: statusId ?? void 0,
              elapsed,
              order: summary.created + 1,
              isCompleted: !!statusId,
              completedAt: statusId ? /* @__PURE__ */ new Date() : null
            }
          });
          testRunCaseIdMap.set(testmoRunTestId, testRunCase.id);
          const resultType = determineJUnitResultType(resolvedStatus, statusName);
          const executedAt = testRunTimestampMap.get(testmoRunId) || /* @__PURE__ */ new Date();
          if (summary.created < 10) {
            console.log(
              `[CREATE] Result #${summary.created + 1}: testmoCaseId=${testmoCaseId}, testmoRunId=${testmoRunId}, caseId=${repositoryCaseId}, caseProject=${actualCaseProjectId}, runId=${testRunId}, runProject=${actualTestRunProjectId}, suiteId=${testSuiteId}`
            );
          }
          if (repositoryCaseId === 69305) {
            console.log(
              `[CASE_69305] Creating result: testmoCaseId=${testmoCaseId}, testmoRunId=${testmoRunId}, testmoProjectId=${testmoProjectId}, testRunTestmoProjectId=${testRunTestmoProjectId}, caseId=${repositoryCaseId}, caseProject=${actualCaseProjectId}, runId=${testRunId}, runProject=${actualTestRunProjectId}, suiteId=${testSuiteId}`
            );
          }
          const junitResult = await tx.jUnitTestResult.create({
            data: {
              repositoryCaseId,
              testSuiteId,
              type: resultType,
              statusId: statusId ?? void 0,
              time: elapsed || void 0,
              assertions: assertions || void 0,
              file: file || void 0,
              line: line ? parseInt(line) : void 0,
              createdById: defaultUserId,
              executedAt
            }
          });
          junitResultIdMap.set(testmoRunTestId, junitResult.id);
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    processedTests += processedInChunk;
    context.processedCount += processedInChunk;
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedTests, progressEntry.total);
    await reportProgress(true);
  }
  await reportProgress(true);
  const suiteIdsToUpdate = Array.from(testSuiteIdMap.values());
  if (suiteIdsToUpdate.length > 0) {
    await prisma2.$transaction(
      async (tx) => {
        await reconcileLegacyJUnitSuiteLinks(tx, suiteIdsToUpdate);
        await recomputeJUnitSuiteStats(tx, suiteIdsToUpdate);
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
  }
  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedTests, progressEntry.total);
  return { summary, testRunCaseIdMap, junitResultIdMap };
};
var importAutomationRunFields = async (prisma2, _configuration, datasetRows, projectIdMap, testRunIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "automationRunFields",
    total: 0,
    created: 0,
    mapped: 0
  };
  const automationRunFieldRows = datasetRows.get("automation_run_fields") ?? [];
  summary.total = automationRunFieldRows.length;
  const entityName = "automationRunFields";
  const progressEntry = context.entityProgress[entityName] ?? (context.entityProgress[entityName] = {
    total: summary.total,
    created: 0,
    mapped: 0
  });
  progressEntry.total = summary.total;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const updateChunkSize = Math.max(1, Math.floor(chunkSize / 2) || 1);
  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2e3;
  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedRows - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.mapped = Math.min(processedRows, progressEntry.total);
    lastReportedCount = processedRows;
    lastReportAt = now;
    const statusMessage = `Processing automation run fields (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} records processed)`;
    await persistProgress(entityName, statusMessage);
  };
  const fieldsByRunId = /* @__PURE__ */ new Map();
  for (const row of automationRunFieldRows) {
    const testmoRunId = toNumberValue(row.run_id);
    const testmoProjectId = toNumberValue(row.project_id);
    const name = toStringValue2(row.name);
    const fieldType = toNumberValue(row.type);
    const value = toStringValue2(row.value);
    processedRows += 1;
    if (!testmoRunId || !testmoProjectId || !name) {
      context.processedCount += 1;
      await reportProgress();
      continue;
    }
    const projectId = projectIdMap.get(testmoProjectId);
    const testRunId = testRunIdMap.get(testmoRunId);
    if (!projectId || !testRunId) {
      context.processedCount += 1;
      await reportProgress();
      continue;
    }
    if (!fieldsByRunId.has(testRunId)) {
      fieldsByRunId.set(testRunId, {});
    }
    const fields = fieldsByRunId.get(testRunId);
    fields[name] = { type: fieldType, value };
    context.processedCount += 1;
    if (processedRows % chunkSize === 0) {
      await reportProgress();
    }
  }
  await reportProgress(true);
  const runEntries = Array.from(fieldsByRunId.entries());
  const totalRuns = runEntries.length;
  let runsProcessed = 0;
  const updateChunks = chunkArray(runEntries, updateChunkSize);
  for (const chunk of updateChunks) {
    const results = await Promise.allSettled(
      chunk.map(
        ([testRunId, fields]) => prisma2.testRuns.update({
          where: { id: testRunId },
          data: { note: fields }
        })
      )
    );
    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        summary.created += 1;
      } else {
        const runId = chunk[idx]?.[0];
        console.error("Failed to update automation run fields", {
          runId,
          error: result.reason
        });
      }
    });
    runsProcessed += chunk.length;
    const statusMessage = `Applying automation run field updates (${runsProcessed.toLocaleString()} / ${totalRuns.toLocaleString()} runs updated)`;
    await persistProgress(entityName, statusMessage);
  }
  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRows, progressEntry.total);
  return summary;
};
var reconcileLegacyJUnitSuiteLinks = async (tx, suiteIds) => {
  if (suiteIds.length === 0) {
    return;
  }
  const chunkSize = 2e3;
  for (const chunk of chunkArray(suiteIds, chunkSize)) {
    await tx.$executeRaw`
      UPDATE "JUnitTestResult" AS r
      SET "testSuiteId" = s."id"
      FROM "JUnitTestSuite" AS s
      WHERE s."id" IN (${import_client2.Prisma.join(chunk)})
        AND r."testSuiteId" = s."testRunId"
        AND r."testSuiteId" IN (SELECT id FROM "TestRuns")
        AND r."testSuiteId" NOT IN (SELECT id FROM "JUnitTestSuite");
    `;
  }
};
var recomputeJUnitSuiteStats = async (tx, suiteIds) => {
  if (suiteIds.length === 0) {
    return;
  }
  const groupedAll = [];
  const chunkSize = 2e3;
  for (const chunk of chunkArray(suiteIds, chunkSize)) {
    const grouped = await tx.jUnitTestResult.groupBy({
      by: ["testSuiteId", "type"],
      where: {
        testSuiteId: {
          in: chunk
        }
      },
      _count: {
        _all: true
      },
      _sum: {
        time: true
      }
    });
    groupedAll.push(...grouped);
  }
  const statsBySuite = /* @__PURE__ */ new Map();
  suiteIds.forEach((id) => {
    statsBySuite.set(id, {
      total: 0,
      failures: 0,
      errors: 0,
      skipped: 0,
      time: 0
    });
  });
  groupedAll.forEach((entry) => {
    const suiteStats = statsBySuite.get(entry.testSuiteId);
    if (!suiteStats) {
      return;
    }
    const count = entry._count?._all ?? 0;
    const timeSum = entry._sum?.time ?? 0;
    suiteStats.total += count;
    suiteStats.time += timeSum;
    switch (entry.type) {
      case import_client2.JUnitResultType.FAILURE:
        suiteStats.failures += count;
        break;
      case import_client2.JUnitResultType.ERROR:
        suiteStats.errors += count;
        break;
      case import_client2.JUnitResultType.SKIPPED:
        suiteStats.skipped += count;
        break;
      default:
        break;
    }
  });
  await Promise.all(
    Array.from(statsBySuite.entries()).map(
      ([suiteId, data]) => tx.jUnitTestSuite.update({
        where: { id: suiteId },
        data: {
          tests: data.total,
          failures: data.failures,
          errors: data.errors,
          skipped: data.skipped,
          time: data.time
        }
      })
    )
  );
};
var importAutomationRunLinks = async (prisma2, _configuration, datasetRows, projectIdMap, testRunIdMap, userIdMap, defaultUserId, context, persistProgress, options) => {
  const summary = {
    entity: "automationRunLinks",
    total: 0,
    created: 0,
    mapped: 0
  };
  const automationRunLinkRows = datasetRows.get("automation_run_links") ?? [];
  summary.total = automationRunLinkRows.length;
  const entityName = "automationRunLinks";
  const progressEntry = context.entityProgress[entityName] ?? (context.entityProgress[entityName] = {
    total: summary.total,
    created: 0,
    mapped: 0
  });
  progressEntry.total = summary.total;
  let processedLinks = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2e3;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedLinks - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedLinks, progressEntry.total);
    lastReportedCount = processedLinks;
    lastReportAt = now;
    const statusMessage = `Processing automation run links (${processedLinks.toLocaleString()} / ${summary.total.toLocaleString()} links processed)`;
    await persistProgress(entityName, statusMessage);
  };
  if (automationRunLinkRows.length === 0) {
    await reportProgress(true);
    return summary;
  }
  for (let index = 0; index < automationRunLinkRows.length; index += chunkSize) {
    const chunk = automationRunLinkRows.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const testmoRunId = toNumberValue(row.run_id);
          const testmoProjectId = toNumberValue(row.project_id);
          const name = toStringValue2(row.name);
          const note = toStringValue2(row.note);
          const url = toStringValue2(row.url);
          processedLinks += 1;
          context.processedCount += 1;
          if (!testmoRunId || !testmoProjectId || !url || !name) {
            continue;
          }
          const projectId = projectIdMap.get(testmoProjectId);
          const testRunId = testRunIdMap.get(testmoRunId);
          if (!projectId || !testRunId) {
            continue;
          }
          await tx.attachments.create({
            data: {
              testRunsId: testRunId,
              url,
              name,
              note: note || void 0,
              mimeType: "text/uri-list",
              size: BigInt(url.length),
              createdById: defaultUserId
            }
          });
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedLinks, progressEntry.total);
    await reportProgress(true);
  }
  await reportProgress(true);
  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedLinks, progressEntry.total);
  return summary;
};
var importAutomationRunTestFields = async (prisma2, _configuration, datasetRows, projectIdMap, testRunIdMap, _testRunCaseIdMap, junitResultIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "automationRunTestFields",
    total: 0,
    created: 0,
    mapped: 0
  };
  const entityName = "automationRunTestFields";
  const automationRunTestFieldRows = datasetRows.get("automation_run_test_fields") ?? [];
  const existingProgress = context.entityProgress[entityName];
  summary.total = automationRunTestFieldRows.length > 0 ? automationRunTestFieldRows.length : existingProgress?.total ?? 0;
  const progressEntry = context.entityProgress[entityName] ?? (context.entityProgress[entityName] = {
    total: summary.total,
    created: 0,
    mapped: 0
  });
  progressEntry.total = summary.total;
  if (summary.total === 0 && context.jobId) {
    summary.total = await prisma2.testmoImportStaging.count({
      where: {
        jobId: context.jobId,
        datasetName: "automation_run_test_fields"
      }
    });
    progressEntry.total = summary.total;
  }
  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(
    1,
    Math.min(Math.floor(summary.total / 50), 5e3)
  );
  const minProgressIntervalMs = 2e3;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedRows - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.mapped = Math.min(processedRows, progressEntry.total);
    lastReportedCount = processedRows;
    lastReportAt = now;
    const statusMessage = `Processing automation run test fields (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} records processed)`;
    await persistProgress(entityName, statusMessage);
  };
  const pendingByTestId = /* @__PURE__ */ new Map();
  let rowsSinceFlush = 0;
  const shouldStream = automationRunTestFieldRows.length === 0 && summary.total > 0;
  const fetchBatchSize = Math.min(Math.max(chunkSize * 4, chunkSize), 5e3);
  const cloneRowData = (data, fieldName, fieldValue, text1, text2, text3, text4) => {
    const cloned = typeof data === "object" && data !== null ? JSON.parse(JSON.stringify(data)) : data;
    if (cloned && typeof cloned === "object") {
      const record = cloned;
      if (fieldValue !== null && fieldValue !== void 0 && record.value === void 0) {
        record.value = fieldValue;
      }
      if (fieldName && (record.name === void 0 || record.name === null)) {
        record.name = fieldName;
      }
      const textEntries = [
        ["text1", text1],
        ["text2", text2],
        ["text3", text3],
        ["text4", text4]
      ];
      for (const [key, value] of textEntries) {
        if (value !== null && value !== void 0 && record[key] === void 0) {
          record[key] = value;
        }
      }
    }
    return cloned;
  };
  const streamStagingRows = async function* () {
    if (!context.jobId) {
      throw new Error(
        "importAutomationRunTestFields requires context.jobId for streaming"
      );
    }
    let nextRowIndex = 0;
    while (true) {
      const stagedRows = await prisma2.testmoImportStaging.findMany({
        where: {
          jobId: context.jobId,
          datasetName: "automation_run_test_fields",
          rowIndex: {
            gte: nextRowIndex,
            lt: nextRowIndex + fetchBatchSize
          }
        },
        orderBy: {
          rowIndex: "asc"
        },
        select: {
          rowIndex: true,
          rowData: true,
          fieldName: true,
          fieldValue: true,
          text1: true,
          text2: true,
          text3: true,
          text4: true
        }
      });
      if (stagedRows.length === 0) {
        break;
      }
      nextRowIndex = stagedRows[stagedRows.length - 1].rowIndex + 1;
      for (const staged of stagedRows) {
        yield cloneRowData(
          staged.rowData,
          staged.fieldName,
          staged.fieldValue,
          staged.text1,
          staged.text2,
          staged.text3,
          staged.text4
        );
      }
    }
  };
  const mergeValues = (current, additions) => {
    const filtered = additions.map((value) => value.trim()).filter((value) => value.length > 0);
    if (filtered.length === 0) {
      return current ?? null;
    }
    const addition = filtered.join("\n\n");
    if (!addition) {
      return current ?? null;
    }
    if (!current || current.trim().length === 0) {
      return addition;
    }
    return `${current}

${addition}`;
  };
  const flushPendingUpdates = async (force = false) => {
    const shouldFlushByRows = rowsSinceFlush >= chunkSize;
    if (!force && pendingByTestId.size < chunkSize && !shouldFlushByRows) {
      return;
    }
    if (pendingByTestId.size === 0) {
      return;
    }
    const entries = Array.from(pendingByTestId.entries());
    pendingByTestId.clear();
    const resultIds = entries.map(([, update]) => update.junitResultId).filter((id) => typeof id === "number");
    const existingResults = resultIds.length > 0 ? await prisma2.jUnitTestResult.findMany({
      where: { id: { in: resultIds } },
      select: { id: true, systemOut: true, systemErr: true }
    }) : [];
    const existingById = new Map(
      existingResults.map((result) => [result.id, result])
    );
    let updatesApplied = 0;
    if (entries.length > 0) {
      await prisma2.$transaction(
        async (tx) => {
          for (const [, update] of entries) {
            const junitResultId = update.junitResultId;
            if (!junitResultId) {
              continue;
            }
            const existing = existingById.get(junitResultId);
            const nextSystemOut = mergeValues(
              existing?.systemOut,
              update.systemOut
            );
            const nextSystemErr = mergeValues(
              existing?.systemErr,
              update.systemErr
            );
            if (nextSystemOut === (existing?.systemOut ?? null) && nextSystemErr === (existing?.systemErr ?? null)) {
              continue;
            }
            await tx.jUnitTestResult.update({
              where: { id: junitResultId },
              data: {
                systemOut: nextSystemOut,
                systemErr: nextSystemErr
              }
            });
            summary.created += 1;
            updatesApplied += 1;
          }
        },
        {
          timeout: options?.transactionTimeoutMs
        }
      );
    }
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRows, summary.total);
    if (updatesApplied > 0 && (processedRows % 5e4 === 0 || processedRows === summary.total)) {
      console.log(
        `[importAutomationRunTestFields] Applied ${updatesApplied} updates (processed ${processedRows}/${summary.total} rows)`
      );
    }
    const statusMessage = `Applying automation run test field updates (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} rows processed)`;
    await persistProgress(entityName, statusMessage);
    rowsSinceFlush = 0;
  };
  const rowIterator = shouldStream ? streamStagingRows() : (async function* () {
    for (const row of automationRunTestFieldRows) {
      yield row;
    }
  })();
  for await (const row of rowIterator) {
    const testmoTestId = toNumberValue(row.test_id);
    const testmoRunId = toNumberValue(row.run_id);
    const testmoProjectId = toNumberValue(row.project_id);
    const name = toStringValue2(row.name);
    let value = toStringValue2(row.value);
    processedRows += 1;
    context.processedCount += 1;
    if (!testmoTestId || !testmoRunId || !testmoProjectId || !name || !value) {
      await reportProgress();
      continue;
    }
    const projectId = projectIdMap.get(testmoProjectId);
    const testRunId = testRunIdMap.get(testmoRunId);
    const junitResultId = junitResultIdMap.get(testmoTestId);
    if (!projectId || !testRunId || !junitResultId) {
      await reportProgress();
      continue;
    }
    const MAX_VALUE_LENGTH = 5e5;
    if (value.length > MAX_VALUE_LENGTH) {
      value = value.substring(0, MAX_VALUE_LENGTH) + "\n\n... (truncated, original length: " + value.length + " characters)";
    }
    const lowerName = name.toLowerCase();
    const pending = pendingByTestId.get(testmoTestId) ?? { junitResultId, systemOut: [], systemErr: [] };
    if (lowerName.includes("error") || lowerName.includes("errors")) {
      pending.systemErr.push(value);
    } else if (lowerName.includes("output")) {
      pending.systemOut.push(value);
    } else {
      pending.systemOut.push(`${name}: ${value}`);
    }
    pending.junitResultId = junitResultId;
    pendingByTestId.set(testmoTestId, pending);
    await reportProgress();
    rowsSinceFlush += 1;
    if (pendingByTestId.size >= chunkSize) {
      await flushPendingUpdates();
      continue;
    }
    if (rowsSinceFlush >= chunkSize) {
      await flushPendingUpdates();
    }
  }
  await reportProgress(true);
  await flushPendingUpdates(true);
  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRows, summary.total);
  return summary;
};
var importAutomationRunTags = async (prisma2, configuration, datasetRows, testRunIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "automationRunTags",
    total: 0,
    created: 0,
    mapped: 0
  };
  const automationRunTagRows = datasetRows.get("automation_run_tags") ?? [];
  summary.total = automationRunTagRows.length;
  const entityName = "automationRunTags";
  const progressEntry = context.entityProgress[entityName] ?? (context.entityProgress[entityName] = {
    total: summary.total,
    created: 0,
    mapped: 0
  });
  progressEntry.total = summary.total;
  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2e3;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedRows - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRows, progressEntry.total);
    lastReportedCount = processedRows;
    lastReportAt = now;
    const statusMessage = `Processing automation run tags (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} assignments processed)`;
    await persistProgress(entityName, statusMessage);
  };
  if (automationRunTagRows.length === 0) {
    await reportProgress(true);
    return summary;
  }
  for (let index = 0; index < automationRunTagRows.length; index += chunkSize) {
    const chunk = automationRunTagRows.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          processedRows += 1;
          context.processedCount += 1;
          const testmoRunId = toNumberValue(row.run_id);
          const testmoTagId = toNumberValue(row.tag_id);
          if (!testmoRunId || !testmoTagId) {
            continue;
          }
          const runId = testRunIdMap.get(testmoRunId);
          if (!runId) {
            continue;
          }
          const tagConfig = configuration.tags?.[testmoTagId];
          if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
            continue;
          }
          const tagId = tagConfig.mappedTo;
          const existing = await tx.testRuns.findFirst({
            where: {
              id: runId,
              tags: {
                some: {
                  id: tagId
                }
              }
            },
            select: { id: true }
          });
          if (existing) {
            summary.mapped += 1;
            continue;
          }
          await tx.testRuns.update({
            where: { id: runId },
            data: {
              tags: {
                connect: { id: tagId }
              }
            }
          });
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRows, progressEntry.total);
    await reportProgress(true);
  }
  await reportProgress(true);
  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRows, progressEntry.total);
  return summary;
};

// workers/testmoImport/tagImports.ts
async function importRepositoryCaseTags(tx, configuration, datasetRows, caseIdMap) {
  const summary = {
    entity: "repositoryCaseTags",
    total: 0,
    created: 0,
    mapped: 0
  };
  const repositoryCaseTagRows = datasetRows.get("repository_case_tags") ?? [];
  for (const row of repositoryCaseTagRows) {
    summary.total += 1;
    const testmoCaseId = toNumberValue(row.case_id);
    const testmoTagId = toNumberValue(row.tag_id);
    if (!testmoCaseId || !testmoTagId) {
      continue;
    }
    const caseId = caseIdMap.get(testmoCaseId);
    if (!caseId) {
      continue;
    }
    const tagConfig = configuration.tags?.[testmoTagId];
    if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
      continue;
    }
    const tagId = tagConfig.mappedTo;
    const existing = await tx.repositoryCases.findFirst({
      where: {
        id: caseId,
        tags: {
          some: {
            id: tagId
          }
        }
      }
    });
    if (existing) {
      summary.mapped += 1;
      continue;
    }
    await tx.repositoryCases.update({
      where: { id: caseId },
      data: {
        tags: {
          connect: { id: tagId }
        }
      }
    });
    summary.created += 1;
  }
  return summary;
}
async function importRunTags(tx, configuration, datasetRows, testRunIdMap) {
  const summary = {
    entity: "runTags",
    total: 0,
    created: 0,
    mapped: 0
  };
  const runTagRows = datasetRows.get("run_tags") ?? [];
  for (const row of runTagRows) {
    summary.total += 1;
    const testmoRunId = toNumberValue(row.run_id);
    const testmoTagId = toNumberValue(row.tag_id);
    if (!testmoRunId || !testmoTagId) {
      continue;
    }
    const runId = testRunIdMap.get(testmoRunId);
    if (!runId) {
      continue;
    }
    const tagConfig = configuration.tags?.[testmoTagId];
    if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
      continue;
    }
    const tagId = tagConfig.mappedTo;
    const existing = await tx.testRuns.findFirst({
      where: {
        id: runId,
        tags: {
          some: {
            id: tagId
          }
        }
      }
    });
    if (existing) {
      summary.mapped += 1;
      continue;
    }
    await tx.testRuns.update({
      where: { id: runId },
      data: {
        tags: {
          connect: { id: tagId }
        }
      }
    });
    summary.created += 1;
  }
  return summary;
}
async function importSessionTags(tx, configuration, datasetRows, sessionIdMap) {
  const summary = {
    entity: "sessionTags",
    total: 0,
    created: 0,
    mapped: 0
  };
  const sessionTagRows = datasetRows.get("session_tags") ?? [];
  for (const row of sessionTagRows) {
    summary.total += 1;
    const testmoSessionId = toNumberValue(row.session_id);
    const testmoTagId = toNumberValue(row.tag_id);
    if (!testmoSessionId || !testmoTagId) {
      continue;
    }
    const sessionId = sessionIdMap.get(testmoSessionId);
    if (!sessionId) {
      continue;
    }
    const tagConfig = configuration.tags?.[testmoTagId];
    if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
      continue;
    }
    const tagId = tagConfig.mappedTo;
    const existing = await tx.sessions.findFirst({
      where: {
        id: sessionId,
        tags: {
          some: {
            id: tagId
          }
        }
      }
    });
    if (existing) {
      summary.mapped += 1;
      continue;
    }
    await tx.sessions.update({
      where: { id: sessionId },
      data: {
        tags: {
          connect: { id: tagId }
        }
      }
    });
    summary.created += 1;
  }
  return summary;
}

// workers/testmoImport/linkImports.ts
var import_core = require("@tiptap/core");
var import_model = require("@tiptap/pm/model");
var import_starter_kit = __toESM(require("@tiptap/starter-kit"));
var import_happy_dom = require("happy-dom");
var TIPTAP_EXTENSIONS = [
  import_starter_kit.default.configure({
    dropcursor: false,
    gapcursor: false,
    undoRedo: false,
    trailingNode: false,
    heading: {
      levels: [1, 2, 3, 4]
    }
  })
];
var TIPTAP_SCHEMA = (0, import_core.getSchema)(TIPTAP_EXTENSIONS);
var sharedHappyDOMWindow = null;
var sharedDOMParser = null;
var getSharedHappyDOM = () => {
  if (!sharedHappyDOMWindow || !sharedDOMParser) {
    if (sharedHappyDOMWindow) {
      try {
        sharedHappyDOMWindow.close();
      } catch (error) {
      }
    }
    sharedHappyDOMWindow = new import_happy_dom.Window();
    sharedDOMParser = new sharedHappyDOMWindow.DOMParser();
  }
  return { window: sharedHappyDOMWindow, parser: sharedDOMParser };
};
var escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var escapeAttribute = (value) => escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var buildLinkHtml = (name, url, note) => {
  const safeLabel = escapeHtml(name);
  const safeUrl = escapeAttribute(url);
  const noteFragment = note ? ` (${escapeHtml(note)})` : "";
  return `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>${noteFragment}</p>`;
};
var convertHtmlToTipTapDoc = (html) => {
  const { parser: parser2 } = getSharedHappyDOM();
  if (!parser2) {
    throw new Error("Failed to initialize DOM parser");
  }
  const htmlString = `<!DOCTYPE html><html><body>${html}</body></html>`;
  const document = parser2.parseFromString(htmlString, "text/html");
  if (!document?.body) {
    throw new Error("Failed to parse HTML content for TipTap conversion");
  }
  return import_model.DOMParser.fromSchema(TIPTAP_SCHEMA).parse(document.body).toJSON();
};
var sanitizeLinkMarks = (node) => {
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark?.type === "link" && mark.attrs) {
        const { href, target } = mark.attrs;
        mark.attrs = {
          href,
          ...target ? { target } : {}
        };
      }
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === "object") {
        sanitizeLinkMarks(child);
      }
    }
  }
};
function createTipTapLink(name, url, note) {
  try {
    const html = buildLinkHtml(name, url, note);
    const doc = convertHtmlToTipTapDoc(html);
    if (doc && Array.isArray(doc.content) && doc.content.length > 0) {
      for (const node of doc.content) {
        if (node && typeof node === "object") {
          sanitizeLinkMarks(node);
        }
      }
      return doc.content[0];
    }
  } catch (error) {
  }
  const linkContent = [
    {
      type: "text",
      marks: [
        {
          type: "link",
          attrs: {
            href: url,
            target: "_blank"
          }
        }
      ],
      text: name
    }
  ];
  if (note) {
    linkContent.push({
      type: "text",
      text: ` (${note})`
    });
  }
  return {
    type: "paragraph",
    content: linkContent
  };
}
function parseExistingDocs(existingDocs) {
  if (!existingDocs) {
    return {
      type: "doc",
      content: []
    };
  }
  if (typeof existingDocs === "object" && existingDocs.type === "doc") {
    return existingDocs;
  }
  if (typeof existingDocs === "string") {
    try {
      const parsed = JSON.parse(existingDocs);
      if (parsed && typeof parsed === "object" && parsed.type === "doc") {
        return parsed;
      }
    } catch (e) {
    }
  }
  return {
    type: "doc",
    content: []
  };
}
function appendLinksToDoc(doc, links) {
  if (!Array.isArray(doc.content)) {
    doc.content = [];
  }
  for (const link of links) {
    doc.content.push(link);
  }
  return doc;
}
var prepareDocsForUpdate = (existingDocs, updatedDocs) => {
  if (typeof existingDocs === "string") {
    return JSON.stringify(updatedDocs);
  }
  return toInputJsonValue(updatedDocs);
};
var importProjectLinks = async (tx, configuration, datasetRows, projectIdMap, context) => {
  const summary = {
    entity: "projectLinks",
    total: 0,
    created: 0,
    mapped: 0
  };
  const projectLinkRows = datasetRows.get("project_links") ?? [];
  summary.total = projectLinkRows.length;
  const linksByProjectId = /* @__PURE__ */ new Map();
  for (const row of projectLinkRows) {
    const testmoProjectId = toNumberValue(row.project_id);
    const name = toStringValue2(row.name);
    const url = toStringValue2(row.url);
    const note = toStringValue2(row.note);
    if (!testmoProjectId || !name || !url) {
      continue;
    }
    const projectId = projectIdMap.get(testmoProjectId);
    if (!projectId) {
      continue;
    }
    const linkJson = createTipTapLink(name, url, note);
    if (!linksByProjectId.has(projectId)) {
      linksByProjectId.set(projectId, []);
    }
    linksByProjectId.get(projectId).push(linkJson);
  }
  for (const [projectId, links] of linksByProjectId.entries()) {
    const project = await tx.projects.findUnique({
      where: { id: projectId },
      select: { docs: true }
    });
    if (!project) {
      continue;
    }
    const doc = parseExistingDocs(project.docs);
    const updatedDocs = appendLinksToDoc(doc, links);
    const docsValue = JSON.stringify(updatedDocs);
    await tx.projects.update({
      where: { id: projectId },
      data: { docs: docsValue }
    });
    summary.created += links.length;
  }
  return summary;
};
var importMilestoneLinks = async (tx, configuration, datasetRows, milestoneIdMap, context) => {
  const summary = {
    entity: "milestoneLinks",
    total: 0,
    created: 0,
    mapped: 0
  };
  const milestoneLinkRows = datasetRows.get("milestone_links") ?? [];
  summary.total = milestoneLinkRows.length;
  const linksByMilestoneId = /* @__PURE__ */ new Map();
  for (const row of milestoneLinkRows) {
    const testmoMilestoneId = toNumberValue(row.milestone_id);
    const name = toStringValue2(row.name);
    const url = toStringValue2(row.url);
    const note = toStringValue2(row.note);
    if (!testmoMilestoneId || !name || !url) {
      continue;
    }
    const milestoneId = milestoneIdMap.get(testmoMilestoneId);
    if (!milestoneId) {
      continue;
    }
    const linkJson = createTipTapLink(name, url, note);
    if (!linksByMilestoneId.has(milestoneId)) {
      linksByMilestoneId.set(milestoneId, []);
    }
    linksByMilestoneId.get(milestoneId).push(linkJson);
  }
  for (const [milestoneId, links] of linksByMilestoneId.entries()) {
    const milestone = await tx.milestones.findUnique({
      where: { id: milestoneId },
      select: { docs: true }
    });
    if (!milestone) {
      continue;
    }
    const doc = parseExistingDocs(milestone.docs);
    const updatedDocs = appendLinksToDoc(doc, links);
    const docsValue = prepareDocsForUpdate(milestone.docs, updatedDocs);
    await tx.milestones.update({
      where: { id: milestoneId },
      data: { docs: docsValue }
    });
    summary.created += links.length;
  }
  return summary;
};
var importRunLinks = async (tx, configuration, datasetRows, testRunIdMap, context) => {
  const summary = {
    entity: "runLinks",
    total: 0,
    created: 0,
    mapped: 0
  };
  const runLinkRows = datasetRows.get("run_links") ?? [];
  summary.total = runLinkRows.length;
  const linksByRunId = /* @__PURE__ */ new Map();
  for (const row of runLinkRows) {
    const testmoRunId = toNumberValue(row.run_id);
    const name = toStringValue2(row.name);
    const url = toStringValue2(row.url);
    const note = toStringValue2(row.note);
    if (!testmoRunId || !name || !url) {
      continue;
    }
    const runId = testRunIdMap.get(testmoRunId);
    if (!runId) {
      continue;
    }
    const linkJson = createTipTapLink(name, url, note);
    if (!linksByRunId.has(runId)) {
      linksByRunId.set(runId, []);
    }
    linksByRunId.get(runId).push(linkJson);
  }
  for (const [runId, links] of linksByRunId.entries()) {
    const run = await tx.testRuns.findUnique({
      where: { id: runId },
      select: { docs: true }
    });
    if (!run) {
      continue;
    }
    const doc = parseExistingDocs(run.docs);
    const updatedDocs = appendLinksToDoc(doc, links);
    const docsValue = prepareDocsForUpdate(run.docs, updatedDocs);
    await tx.testRuns.update({
      where: { id: runId },
      data: { docs: docsValue }
    });
    summary.created += links.length;
  }
  return summary;
};

// workers/testmoImport/templateImports.ts
var import_client3 = require("@prisma/client");
var SYSTEM_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;
var generateSystemName = (value) => {
  const normalized = value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/^[^a-z]+/, "");
  return normalized || "status";
};
async function importTemplates(tx, configuration) {
  const summary = {
    entity: "templates",
    total: 0,
    created: 0,
    mapped: 0
  };
  const templateMap = /* @__PURE__ */ new Map();
  for (const [key, config] of Object.entries(configuration.templates ?? {})) {
    const templateKey = Number(key);
    if (!Number.isFinite(templateKey) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Template ${templateKey} is configured to map but no target template was provided.`
        );
      }
      const existing2 = await tx.templates.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing2) {
        throw new Error(
          `Template ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing2.id;
      config.name = config.name ?? existing2.templateName;
      templateMap.set(existing2.templateName, existing2.id);
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Template ${templateKey} requires a name before it can be created.`
      );
    }
    const existing = await tx.templates.findFirst({
      where: {
        templateName: name,
        isDeleted: false
      }
    });
    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.templateName;
      templateMap.set(existing.templateName, existing.id);
      summary.mapped += 1;
      continue;
    }
    const created = await tx.templates.create({
      data: {
        templateName: name,
        isEnabled: true,
        isDefault: false
      }
    });
    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.templateName;
    templateMap.set(created.templateName, created.id);
    summary.created += 1;
  }
  const processedNames = new Set(templateMap.keys());
  for (const entry of Object.values(configuration.templateFields ?? {})) {
    if (!entry) {
      continue;
    }
    const rawName = typeof entry.templateName === "string" ? entry.templateName : null;
    const templateName = rawName?.trim();
    if (!templateName || processedNames.has(templateName)) {
      continue;
    }
    processedNames.add(templateName);
    summary.total += 1;
    const existing = await tx.templates.findFirst({
      where: { templateName, isDeleted: false }
    });
    if (existing) {
      templateMap.set(templateName, existing.id);
      summary.mapped += 1;
      continue;
    }
    const created = await tx.templates.create({
      data: {
        templateName,
        isEnabled: true,
        isDefault: false
      }
    });
    templateMap.set(templateName, created.id);
    summary.created += 1;
  }
  return { summary, templateMap };
}
async function importTemplateFields(tx, configuration, templateMap, datasetRows) {
  const summary = {
    entity: "templateFields",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      optionsCreated: 0,
      assignmentsCreated: 0
    }
  };
  const details = summary.details;
  const ensureFieldTypeExists = async (typeId) => {
    try {
      const existing = await tx.caseFieldTypes.findUnique({
        where: { id: typeId }
      });
      if (!existing) {
        console.error(
          `[ERROR] Field type ${typeId} referenced by a template field was not found.`
        );
        const availableTypes = await tx.caseFieldTypes.findMany({
          select: { id: true, type: true }
        });
        console.error(`[ERROR] Available field types:`, availableTypes);
        throw new Error(
          `Field type ${typeId} referenced by a template field was not found. Available types: ${availableTypes.map((t) => `${t.id}:${t.type}`).join(", ")}`
        );
      }
    } catch (error) {
      console.error(`[ERROR] Failed to check field type ${typeId}:`, error);
      throw error;
    }
  };
  const toNumberOrNull = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return null;
  };
  const normalizeOptionConfigs = (input) => {
    if (!Array.isArray(input)) {
      return [];
    }
    const normalized = [];
    input.forEach((entry, index) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (!trimmed) {
          return;
        }
        normalized.push({
          name: trimmed,
          iconId: null,
          iconColorId: null,
          isEnabled: true,
          isDefault: index === 0,
          order: index
        });
        return;
      }
      if (!entry || typeof entry !== "object") {
        return;
      }
      const record = entry;
      const rawName = typeof record.name === "string" ? record.name : typeof record.label === "string" ? record.label : typeof record.value === "string" ? record.value : typeof record.displayName === "string" ? record.displayName : typeof record.display_name === "string" ? record.display_name : null;
      const name = rawName?.trim();
      if (!name) {
        return;
      }
      const iconId = toNumberOrNull(
        record.iconId ?? record.icon_id ?? record.icon ?? record.iconID
      ) ?? null;
      const iconColorId = toNumberOrNull(
        record.iconColorId ?? record.icon_color_id ?? record.colorId ?? record.color_id ?? record.color
      ) ?? null;
      const isEnabled = toBooleanValue(
        record.isEnabled ?? record.enabled ?? record.is_enabled,
        true
      );
      const isDefault = toBooleanValue(
        record.isDefault ?? record.is_default ?? record.default ?? record.defaultOption,
        false
      );
      const order = toNumberOrNull(
        record.order ?? record.position ?? record.ordinal ?? record.index ?? record.sort
      ) ?? index;
      normalized.push({
        name,
        iconId,
        iconColorId,
        isEnabled,
        isDefault,
        order
      });
    });
    if (normalized.length === 0) {
      return [];
    }
    const sorted = normalized.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let defaultSeen = false;
    sorted.forEach((entry) => {
      if (entry.isDefault) {
        if (!defaultSeen) {
          defaultSeen = true;
        } else {
          entry.isDefault = false;
        }
      }
    });
    if (!defaultSeen) {
      sorted[0].isDefault = true;
    }
    return sorted.map((entry, index) => ({
      name: entry.name,
      iconId: entry.iconId ?? null,
      iconColorId: entry.iconColorId ?? null,
      isEnabled: entry.isEnabled ?? true,
      isDefault: entry.isDefault ?? false,
      order: index
    }));
  };
  const templateIdBySourceId = /* @__PURE__ */ new Map();
  for (const [templateKey, templateConfig] of Object.entries(
    configuration.templates ?? {}
  )) {
    const sourceId = Number(templateKey);
    if (Number.isFinite(sourceId) && templateConfig && templateConfig.mappedTo !== null && templateConfig.mappedTo !== void 0) {
      templateIdBySourceId.set(sourceId, templateConfig.mappedTo);
    }
  }
  const fieldIdBySourceId = /* @__PURE__ */ new Map();
  const fieldTargetTypeBySourceId = /* @__PURE__ */ new Map();
  const templateSourceNameById = /* @__PURE__ */ new Map();
  const templateDatasetRows = datasetRows.get("templates") ?? [];
  for (const row of templateDatasetRows) {
    const record = row;
    const sourceId = toNumberValue(record.id);
    const name = toStringValue2(record.name);
    if (sourceId !== null && name) {
      templateSourceNameById.set(sourceId, name);
    }
  }
  const appliedAssignments = /* @__PURE__ */ new Set();
  const makeAssignmentKey = (fieldId, templateId, targetType) => `${targetType}:${templateId}:${fieldId}`;
  const resolveTemplateIdForName = async (templateName) => {
    const trimmed = templateName.trim();
    if (!trimmed) {
      return null;
    }
    const templateId = templateMap.get(trimmed);
    if (templateId) {
      return templateId;
    }
    const existing = await tx.templates.findFirst({
      where: { templateName: trimmed, isDeleted: false }
    });
    if (existing) {
      templateMap.set(existing.templateName, existing.id);
      return existing.id;
    }
    const created = await tx.templates.create({
      data: {
        templateName: trimmed,
        isEnabled: true,
        isDefault: false
      }
    });
    templateMap.set(created.templateName, created.id);
    return created.id;
  };
  const assignFieldToTemplate = async (fieldId, templateId, targetType, order) => {
    const assignmentKey = makeAssignmentKey(fieldId, templateId, targetType);
    if (appliedAssignments.has(assignmentKey)) {
      return;
    }
    try {
      if (targetType === "case") {
        await tx.templateCaseAssignment.create({
          data: {
            caseFieldId: fieldId,
            templateId,
            order: order ?? 0
          }
        });
      } else {
        await tx.templateResultAssignment.create({
          data: {
            resultFieldId: fieldId,
            templateId,
            order: order ?? 0
          }
        });
      }
      appliedAssignments.add(assignmentKey);
      details.assignmentsCreated += 1;
    } catch (error) {
      if (!(error instanceof import_client3.Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
      appliedAssignments.add(assignmentKey);
    }
  };
  for (const [key, config] of Object.entries(
    configuration.templateFields ?? {}
  )) {
    const fieldId = Number(key);
    if (!Number.isFinite(fieldId) || !config) {
      continue;
    }
    summary.total += 1;
    const targetType = config.targetType === "result" ? "result" : "case";
    config.targetType = targetType;
    fieldTargetTypeBySourceId.set(fieldId, targetType);
    const templateName = (config.templateName ?? "").trim();
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Template field ${fieldId} is configured to map but no target field was provided.`
        );
      }
      if (targetType === "case") {
        const existing = await tx.caseFields.findUnique({
          where: { id: config.mappedTo }
        });
        if (!existing) {
          throw new Error(
            `Case field ${config.mappedTo} selected for mapping was not found.`
          );
        }
      } else {
        const existing = await tx.resultFields.findUnique({
          where: { id: config.mappedTo }
        });
        if (!existing) {
          throw new Error(
            `Result field ${config.mappedTo} selected for mapping was not found.`
          );
        }
      }
      summary.mapped += 1;
      fieldIdBySourceId.set(fieldId, config.mappedTo);
      if (templateName) {
        const templateId = await resolveTemplateIdForName(templateName);
        if (templateId) {
          await assignFieldToTemplate(
            config.mappedTo,
            templateId,
            targetType,
            config.order ?? 0
          );
        }
      }
      continue;
    }
    const displayName = (config.displayName ?? config.systemName ?? `Field ${fieldId}`).trim();
    let systemName = (config.systemName ?? "").trim();
    if (!systemName) {
      systemName = generateSystemName(displayName);
    }
    if (!SYSTEM_NAME_REGEX.test(systemName)) {
      throw new Error(
        `Template field "${displayName}" requires a valid system name (letters, numbers, underscore, starting with a letter).`
      );
    }
    const typeId = config.typeId ?? null;
    if (typeId === null) {
      throw new Error(
        `Template field "${displayName}" requires a field type before it can be created.`
      );
    }
    console.log(
      `[DEBUG] Processing field "${displayName}" (${systemName}) with typeId ${typeId}, action: ${config.action}`
    );
    await ensureFieldTypeExists(typeId);
    if (targetType === "case") {
      const existing = await tx.caseFields.findFirst({
        where: {
          systemName,
          isDeleted: false
        }
      });
      if (existing) {
        config.action = "map";
        config.mappedTo = existing.id;
        config.systemName = existing.systemName;
        config.displayName = existing.displayName;
        summary.mapped += 1;
        continue;
      }
    } else {
      const existing = await tx.resultFields.findFirst({
        where: {
          systemName,
          isDeleted: false
        }
      });
      if (existing) {
        config.action = "map";
        config.mappedTo = existing.id;
        config.systemName = existing.systemName;
        config.displayName = existing.displayName;
        summary.mapped += 1;
        continue;
      }
    }
    const fieldData = {
      displayName,
      systemName,
      hint: (config.hint ?? "").trim() || null,
      typeId,
      isRequired: config.isRequired ?? false,
      isRestricted: config.isRestricted ?? false,
      defaultValue: config.defaultValue ?? null,
      isChecked: config.isChecked ?? null,
      minValue: toNumberOrNull(config.minValue ?? config.minIntegerValue) ?? null,
      maxValue: toNumberOrNull(config.maxValue ?? config.maxIntegerValue) ?? null,
      initialHeight: toNumberOrNull(config.initialHeight) ?? null,
      isEnabled: true
    };
    const createdField = targetType === "case" ? await tx.caseFields.create({ data: fieldData }) : await tx.resultFields.create({ data: fieldData });
    config.action = "map";
    config.mappedTo = createdField.id;
    config.displayName = createdField.displayName;
    config.systemName = createdField.systemName;
    config.typeId = createdField.typeId;
    fieldIdBySourceId.set(fieldId, createdField.id);
    const dropdownOptionConfigs = normalizeOptionConfigs(
      config.dropdownOptions ?? []
    );
    if (dropdownOptionConfigs.length > 0) {
      const defaultIcon = await tx.fieldIcon.findFirst({
        orderBy: { id: "asc" },
        select: { id: true }
      });
      const defaultColor = await tx.color.findFirst({
        orderBy: { id: "asc" },
        select: { id: true }
      });
      if (!defaultIcon || !defaultColor) {
        throw new Error(
          "Default icon or color not found. Please ensure the database is properly seeded with FieldIcon and Color records."
        );
      }
      const createdOptions = [];
      for (const optionConfig of dropdownOptionConfigs) {
        const option = await tx.fieldOptions.create({
          data: {
            name: optionConfig.name,
            iconId: optionConfig.iconId ?? defaultIcon.id,
            iconColorId: optionConfig.iconColorId ?? defaultColor.id,
            isEnabled: optionConfig.isEnabled ?? true,
            isDefault: optionConfig.isDefault ?? false,
            isDeleted: false,
            order: optionConfig.order ?? 0
          }
        });
        createdOptions.push({
          id: option.id,
          order: optionConfig.order ?? 0
        });
      }
      if (targetType === "case") {
        await tx.caseFieldAssignment.createMany({
          data: createdOptions.map((option) => ({
            fieldOptionId: option.id,
            caseFieldId: createdField.id
          })),
          skipDuplicates: true
        });
      } else {
        await tx.resultFieldAssignment.createMany({
          data: createdOptions.map((option) => ({
            fieldOptionId: option.id,
            resultFieldId: createdField.id,
            order: option.order
          })),
          skipDuplicates: true
        });
      }
      details.optionsCreated += createdOptions.length;
      config.dropdownOptions = dropdownOptionConfigs;
    } else {
      config.dropdownOptions = void 0;
    }
    if (templateName) {
      const templateId = await resolveTemplateIdForName(templateName);
      if (templateId) {
        await assignFieldToTemplate(
          createdField.id,
          templateId,
          targetType,
          config.order ?? 0
        );
      }
    }
    summary.created += 1;
  }
  const templateFieldRows = datasetRows.get("template_fields") ?? [];
  for (const row of templateFieldRows) {
    const record = row;
    const templateSourceId = toNumberValue(record.template_id);
    const fieldSourceId = toNumberValue(record.field_id);
    if (templateSourceId === null || fieldSourceId === null) {
      continue;
    }
    let templateId = templateIdBySourceId.get(templateSourceId);
    const fieldId = fieldIdBySourceId.get(fieldSourceId);
    const targetType = fieldTargetTypeBySourceId.get(fieldSourceId);
    if (!fieldId || !targetType) {
      continue;
    }
    if (!templateId) {
      const templateName = templateSourceNameById.get(templateSourceId);
      if (!templateName) {
        continue;
      }
      const resolvedTemplateId = await resolveTemplateIdForName(templateName);
      if (!resolvedTemplateId) {
        continue;
      }
      templateIdBySourceId.set(templateSourceId, resolvedTemplateId);
      templateId = resolvedTemplateId;
    }
    await assignFieldToTemplate(fieldId, templateId, targetType, void 0);
  }
  templateDatasetRows.length = 0;
  templateFieldRows.length = 0;
  templateSourceNameById.clear();
  templateIdBySourceId.clear();
  fieldIdBySourceId.clear();
  fieldTargetTypeBySourceId.clear();
  appliedAssignments.clear();
  return summary;
}

// workers/testmoImport/issueImports.ts
var import_client4 = require("@prisma/client");
var PROGRESS_UPDATE_INTERVAL = 500;
var mapIssueTargetType = (testmoType) => {
  switch (testmoType) {
    case 1:
    case 4:
      return import_client4.IntegrationProvider.JIRA;
    case 2:
      return import_client4.IntegrationProvider.GITHUB;
    case 3:
      return import_client4.IntegrationProvider.AZURE_DEVOPS;
    default:
      return import_client4.IntegrationProvider.SIMPLE_URL;
  }
};
var importIssueTargets = async (tx, configuration, context, persistProgress) => {
  const summary = {
    entity: "issueTargets",
    total: 0,
    created: 0,
    mapped: 0
  };
  const integrationIdMap = /* @__PURE__ */ new Map();
  let processedSinceLastPersist = 0;
  for (const [key, config] of Object.entries(configuration.issueTargets ?? {})) {
    const sourceId = Number(key);
    if (!Number.isFinite(sourceId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Issue target ${sourceId} is configured to map but no target integration was provided.`
        );
      }
      const existing2 = await tx.integration.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing2) {
        throw new Error(
          `Integration ${config.mappedTo} selected for mapping was not found.`
        );
      }
      integrationIdMap.set(sourceId, existing2.id);
      config.mappedTo = existing2.id;
      summary.mapped += 1;
      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
        await persistProgress("issueTargets");
        processedSinceLastPersist = 0;
      }
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Issue target ${sourceId} requires a name before it can be created.`
      );
    }
    const provider = config.provider ? config.provider : config.testmoType ? mapIssueTargetType(config.testmoType) : import_client4.IntegrationProvider.SIMPLE_URL;
    const existing = await tx.integration.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (existing) {
      integrationIdMap.set(sourceId, existing.id);
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
    } else {
      const integration = await tx.integration.create({
        data: {
          name,
          provider,
          authType: import_client4.IntegrationAuthType.NONE,
          status: import_client4.IntegrationStatus.INACTIVE,
          credentials: {},
          // Empty credentials for now
          settings: {
            testmoSourceId: sourceId,
            testmoType: config.testmoType,
            importedFrom: "testmo"
          }
        }
      });
      integrationIdMap.set(sourceId, integration.id);
      config.action = "map";
      config.mappedTo = integration.id;
      config.name = integration.name;
      summary.created += 1;
    }
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      await persistProgress("issueTargets");
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    await persistProgress("issueTargets");
  }
  return { summary, integrationIdMap };
};
var constructExternalUrl = (provider, baseUrl, externalKey) => {
  if (!baseUrl) {
    return null;
  }
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  switch (provider) {
    case import_client4.IntegrationProvider.JIRA:
      return `${cleanBaseUrl}/browse/${externalKey}`;
    case import_client4.IntegrationProvider.GITHUB:
      return `${cleanBaseUrl}/issues/${externalKey}`;
    case import_client4.IntegrationProvider.AZURE_DEVOPS:
      return `${cleanBaseUrl}/_workitems/edit/${externalKey}`;
    case import_client4.IntegrationProvider.SIMPLE_URL:
      if (baseUrl.includes("{issueId}")) {
        return baseUrl.replace("{issueId}", externalKey);
      }
      return `${cleanBaseUrl}/${externalKey}`;
    default:
      return null;
  }
};
var importIssues = async (tx, datasetRows, integrationIdMap, projectIdMap, createdById, context, persistProgress) => {
  const summary = {
    entity: "issues",
    total: 0,
    created: 0,
    mapped: 0
  };
  const issueIdMap = /* @__PURE__ */ new Map();
  const issueRows = datasetRows.get("issues") ?? [];
  if (issueRows.length === 0) {
    return { summary, issueIdMap };
  }
  summary.total = issueRows.length;
  let processedSinceLastPersist = 0;
  const integrationCache = /* @__PURE__ */ new Map();
  for (const row of issueRows) {
    const record = row;
    const sourceId = toNumberValue(record.id);
    const targetSourceId = toNumberValue(record.target_id);
    const projectSourceId = toNumberValue(record.project_id);
    const displayId = toStringValue2(record.display_id);
    if (sourceId === null || targetSourceId === null || !displayId) {
      continue;
    }
    const integrationId = integrationIdMap.get(targetSourceId);
    if (!integrationId) {
      continue;
    }
    const projectId = projectSourceId !== null ? projectIdMap.get(projectSourceId) : null;
    const existing = await tx.issue.findFirst({
      where: {
        externalId: displayId,
        integrationId
      }
    });
    if (existing) {
      issueIdMap.set(sourceId, existing.id);
      summary.mapped += 1;
    } else {
      if (!integrationCache.has(integrationId)) {
        const integration = await tx.integration.findUnique({
          where: { id: integrationId },
          select: { provider: true, settings: true }
        });
        if (integration) {
          const settings = integration.settings;
          integrationCache.set(integrationId, {
            provider: integration.provider,
            baseUrl: settings?.baseUrl
          });
        }
      }
      const integrationInfo = integrationCache.get(integrationId);
      const externalUrl = integrationInfo ? constructExternalUrl(integrationInfo.provider, integrationInfo.baseUrl, displayId) : null;
      const issue = await tx.issue.create({
        data: {
          name: displayId,
          title: displayId,
          externalId: displayId,
          externalKey: displayId,
          externalUrl,
          integrationId,
          projectId: projectId ?? void 0,
          createdById,
          data: {
            testmoSourceId: sourceId,
            importedFrom: "testmo"
          }
        }
      });
      issueIdMap.set(sourceId, issue.id);
      summary.created += 1;
    }
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      await persistProgress("issues");
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    await persistProgress("issues");
  }
  return { summary, issueIdMap };
};
var importMilestoneIssues = async (tx, datasetRows, milestoneIdMap, issueIdMap, context, persistProgress) => {
  const summary = {
    entity: "milestoneIssues",
    total: 0,
    created: 0,
    mapped: 0
  };
  const milestoneIssueRows = datasetRows.get("milestone_issues") ?? [];
  summary.total = milestoneIssueRows.length;
  if (milestoneIssueRows.length > 0) {
    console.warn(
      `Skipping import of ${milestoneIssueRows.length} milestone-issue relationships - Milestones model does not have an issues relation. Add 'issues Issue[]' to the Milestones model in schema.zmodel to enable this feature.`
    );
  }
  return summary;
};
var importRepositoryCaseIssues = async (prisma2, datasetRows, caseIdMap, issueIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "repositoryCaseIssues",
    total: 0,
    created: 0,
    mapped: 0
  };
  const repositoryCaseIssueRows = datasetRows.get("repository_case_issues") ?? [];
  if (repositoryCaseIssueRows.length === 0) {
    return summary;
  }
  summary.total = repositoryCaseIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1e3);
  let processedCount = 0;
  for (let index = 0; index < repositoryCaseIssueRows.length; index += chunkSize) {
    const chunk = repositoryCaseIssueRows.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const record = row;
          const caseSourceId = toNumberValue(record.case_id);
          const issueSourceId = toNumberValue(record.issue_id);
          processedCount += 1;
          context.processedCount += 1;
          if (caseSourceId === null || issueSourceId === null) {
            continue;
          }
          const caseId = caseIdMap.get(caseSourceId);
          const issueId = issueIdMap.get(issueSourceId);
          if (!caseId || !issueId) {
            continue;
          }
          await tx.repositoryCases.update({
            where: { id: caseId },
            data: {
              issues: {
                connect: { id: issueId }
              }
            }
          });
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    const statusMessage = `Processing repository case issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("repositoryCaseIssues", statusMessage);
  }
  return summary;
};
var importRunIssues = async (prisma2, datasetRows, testRunIdMap, issueIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "runIssues",
    total: 0,
    created: 0,
    mapped: 0
  };
  const runIssueRows = datasetRows.get("run_issues") ?? [];
  if (runIssueRows.length === 0) {
    return summary;
  }
  summary.total = runIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1e3);
  let processedCount = 0;
  for (let index = 0; index < runIssueRows.length; index += chunkSize) {
    const chunk = runIssueRows.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const record = row;
          const runSourceId = toNumberValue(record.run_id);
          const issueSourceId = toNumberValue(record.issue_id);
          processedCount += 1;
          context.processedCount += 1;
          if (runSourceId === null || issueSourceId === null) {
            continue;
          }
          const runId = testRunIdMap.get(runSourceId);
          const issueId = issueIdMap.get(issueSourceId);
          if (!runId || !issueId) {
            continue;
          }
          await tx.testRuns.update({
            where: { id: runId },
            data: {
              issues: {
                connect: { id: issueId }
              }
            }
          });
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    const statusMessage = `Processing test run issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("runIssues", statusMessage);
  }
  return summary;
};
var importRunResultIssues = async (prisma2, datasetRows, testRunResultIdMap, issueIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "runResultIssues",
    total: 0,
    created: 0,
    mapped: 0
  };
  const runResultIssueRows = datasetRows.get("run_result_issues") ?? [];
  if (runResultIssueRows.length === 0) {
    return summary;
  }
  summary.total = runResultIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1e3);
  let processedCount = 0;
  for (let index = 0; index < runResultIssueRows.length; index += chunkSize) {
    const chunk = runResultIssueRows.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const record = row;
          const resultSourceId = toNumberValue(record.result_id);
          const issueSourceId = toNumberValue(record.issue_id);
          processedCount += 1;
          context.processedCount += 1;
          if (resultSourceId === null || issueSourceId === null) {
            continue;
          }
          const resultId = testRunResultIdMap.get(resultSourceId);
          const issueId = issueIdMap.get(issueSourceId);
          if (!resultId || !issueId) {
            continue;
          }
          await tx.testRunResults.update({
            where: { id: resultId },
            data: {
              issues: {
                connect: { id: issueId }
              }
            }
          });
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    const statusMessage = `Processing test run result issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("runResultIssues", statusMessage);
  }
  return summary;
};
var importSessionIssues = async (prisma2, datasetRows, sessionIdMap, issueIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "sessionIssues",
    total: 0,
    created: 0,
    mapped: 0
  };
  const sessionIssueRows = datasetRows.get("session_issues") ?? [];
  if (sessionIssueRows.length === 0) {
    return summary;
  }
  summary.total = sessionIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1e3);
  let processedCount = 0;
  for (let index = 0; index < sessionIssueRows.length; index += chunkSize) {
    const chunk = sessionIssueRows.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const record = row;
          const sessionSourceId = toNumberValue(record.session_id);
          const issueSourceId = toNumberValue(record.issue_id);
          processedCount += 1;
          context.processedCount += 1;
          if (sessionSourceId === null || issueSourceId === null) {
            continue;
          }
          const sessionId = sessionIdMap.get(sessionSourceId);
          const issueId = issueIdMap.get(issueSourceId);
          if (!sessionId || !issueId) {
            continue;
          }
          await tx.sessions.update({
            where: { id: sessionId },
            data: {
              issues: {
                connect: { id: issueId }
              }
            }
          });
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    const statusMessage = `Processing session issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("sessionIssues", statusMessage);
  }
  return summary;
};
var importSessionResultIssues = async (prisma2, datasetRows, sessionResultIdMap, issueIdMap, context, persistProgress, options) => {
  const summary = {
    entity: "sessionResultIssues",
    total: 0,
    created: 0,
    mapped: 0
  };
  const sessionResultIssueRows = datasetRows.get("session_result_issues") ?? [];
  if (sessionResultIssueRows.length === 0) {
    return summary;
  }
  summary.total = sessionResultIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1e3);
  let processedCount = 0;
  for (let index = 0; index < sessionResultIssueRows.length; index += chunkSize) {
    const chunk = sessionResultIssueRows.slice(index, index + chunkSize);
    await prisma2.$transaction(
      async (tx) => {
        for (const row of chunk) {
          const record = row;
          const resultSourceId = toNumberValue(record.result_id);
          const issueSourceId = toNumberValue(record.issue_id);
          processedCount += 1;
          context.processedCount += 1;
          if (resultSourceId === null || issueSourceId === null) {
            continue;
          }
          const resultId = sessionResultIdMap.get(resultSourceId);
          const issueId = issueIdMap.get(issueSourceId);
          if (!resultId || !issueId) {
            continue;
          }
          await tx.sessionResults.update({
            where: { id: resultId },
            data: {
              issues: {
                connect: { id: issueId }
              }
            }
          });
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs
      }
    );
    const statusMessage = `Processing session result issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("sessionResultIssues", statusMessage);
  }
  return summary;
};
var createProjectIntegrations = async (tx, datasetRows, projectIdMap, integrationIdMap, context, persistProgress) => {
  const summary = {
    entity: "projectIntegrations",
    total: 0,
    created: 0,
    mapped: 0
  };
  const issueRows = datasetRows.get("issues") ?? [];
  if (issueRows.length === 0) {
    return summary;
  }
  const projectIntegrationsMap = /* @__PURE__ */ new Map();
  for (const row of issueRows) {
    const record = row;
    const targetSourceId = toNumberValue(record.target_id);
    const projectSourceId = toNumberValue(record.project_id);
    if (targetSourceId === null || projectSourceId === null) {
      continue;
    }
    const integrationId = integrationIdMap.get(targetSourceId);
    const projectId = projectIdMap.get(projectSourceId);
    if (!integrationId || !projectId) {
      continue;
    }
    if (!projectIntegrationsMap.has(projectId)) {
      projectIntegrationsMap.set(projectId, /* @__PURE__ */ new Set());
    }
    projectIntegrationsMap.get(projectId).add(integrationId);
  }
  summary.total = projectIntegrationsMap.size;
  let processedSinceLastPersist = 0;
  for (const [projectId, integrationIds] of projectIntegrationsMap) {
    for (const integrationId of integrationIds) {
      const existing = await tx.projectIntegration.findFirst({
        where: {
          projectId,
          integrationId
        }
      });
      if (!existing) {
        await tx.projectIntegration.create({
          data: {
            projectId,
            integrationId,
            isActive: true
          }
        });
        summary.created += 1;
      } else {
        summary.mapped += 1;
      }
      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
        await persistProgress("projectIntegrations");
        processedSinceLastPersist = 0;
      }
    }
  }
  if (processedSinceLastPersist > 0) {
    await persistProgress("projectIntegrations");
  }
  return summary;
};

// workers/testmoImportWorker.ts
var import_meta = {};
var prisma = new import_client5.PrismaClient();
var projectNameCache2 = /* @__PURE__ */ new Map();
var templateNameCache2 = /* @__PURE__ */ new Map();
var workflowNameCache2 = /* @__PURE__ */ new Map();
var configurationNameCache = /* @__PURE__ */ new Map();
var milestoneNameCache = /* @__PURE__ */ new Map();
var userNameCache2 = /* @__PURE__ */ new Map();
var folderNameCache2 = /* @__PURE__ */ new Map();
var getProjectName2 = async (tx, projectId) => {
  if (projectNameCache2.has(projectId)) {
    return projectNameCache2.get(projectId);
  }
  const project = await tx.projects.findUnique({
    where: { id: projectId },
    select: { name: true }
  });
  const name = project?.name ?? `Project ${projectId}`;
  projectNameCache2.set(projectId, name);
  return name;
};
var getTemplateName2 = async (tx, templateId) => {
  if (templateNameCache2.has(templateId)) {
    return templateNameCache2.get(templateId);
  }
  const template = await tx.templates.findUnique({
    where: { id: templateId },
    select: { templateName: true }
  });
  const name = template?.templateName ?? `Template ${templateId}`;
  templateNameCache2.set(templateId, name);
  return name;
};
var getWorkflowName2 = async (tx, workflowId) => {
  if (workflowNameCache2.has(workflowId)) {
    return workflowNameCache2.get(workflowId);
  }
  const workflow = await tx.workflows.findUnique({
    where: { id: workflowId },
    select: { name: true }
  });
  const name = workflow?.name ?? `Workflow ${workflowId}`;
  workflowNameCache2.set(workflowId, name);
  return name;
};
var getConfigurationName = async (tx, configurationId) => {
  if (configurationNameCache.has(configurationId)) {
    return configurationNameCache.get(configurationId);
  }
  const configuration = await tx.configurations.findUnique({
    where: { id: configurationId },
    select: { name: true }
  });
  const name = configuration?.name ?? null;
  if (name !== null) {
    configurationNameCache.set(configurationId, name);
  }
  return name;
};
var getMilestoneName = async (tx, milestoneId) => {
  if (milestoneNameCache.has(milestoneId)) {
    return milestoneNameCache.get(milestoneId);
  }
  const milestone = await tx.milestones.findUnique({
    where: { id: milestoneId },
    select: { name: true }
  });
  const name = milestone?.name ?? null;
  if (name !== null) {
    milestoneNameCache.set(milestoneId, name);
  }
  return name;
};
var getUserName2 = async (tx, userId) => {
  if (!userId) {
    return "Automation Import";
  }
  if (userNameCache2.has(userId)) {
    return userNameCache2.get(userId);
  }
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true }
  });
  const name = user?.name ?? userId;
  userNameCache2.set(userId, name);
  return name;
};
var getFolderName2 = async (tx, folderId) => {
  if (folderNameCache2.has(folderId)) {
    return folderNameCache2.get(folderId);
  }
  const folder = await tx.repositoryFolders.findUnique({
    where: { id: folderId },
    select: { name: true }
  });
  const name = folder?.name ?? "";
  folderNameCache2.set(folderId, name);
  return name;
};
var parseNumberEnv = (value, fallback) => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
var IMPORT_TRANSACTION_TIMEOUT_MS = parseNumberEnv(
  process.env.TESTMO_IMPORT_TRANSACTION_TIMEOUT_MS,
  15 * 60 * 1e3
);
var AUTOMATION_TRANSACTION_TIMEOUT_MS = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_TRANSACTION_TIMEOUT_MS,
  45 * 60 * 1e3
);
var IMPORT_TRANSACTION_MAX_WAIT_MS = parseNumberEnv(
  process.env.TESTMO_IMPORT_TRANSACTION_MAX_WAIT_MS,
  3e4
);
var bucketName = process.env.AWS_BUCKET_NAME;
var s3Client = new import_client_s3.S3Client({
  region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  endpoint: process.env.AWS_PUBLIC_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL,
  forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
  maxAttempts: 5
  // Retry transient network errors
});
var FINAL_STATUSES = /* @__PURE__ */ new Set(["COMPLETED", "FAILED", "CANCELED"]);
var VALID_APPLICATION_AREAS = new Set(Object.values(import_client5.ApplicationArea));
var VALID_WORKFLOW_TYPES = new Set(Object.values(import_client5.WorkflowType));
var VALID_WORKFLOW_SCOPES = new Set(Object.values(import_client5.WorkflowScope));
var SYSTEM_NAME_REGEX2 = /^[A-Za-z][A-Za-z0-9_]*$/;
var DEFAULT_STATUS_COLOR_HEX = "#B1B2B3";
var MAX_INT_32 = 2147483647;
var MIN_INT_32 = -2147483648;
var currentTimestamp = () => (/* @__PURE__ */ new Date()).toISOString();
var createInitialContext = (jobId) => ({
  activityLog: [],
  entityProgress: {},
  processedCount: 0,
  startTime: Date.now(),
  lastProgressUpdate: Date.now(),
  jobId,
  recentProgress: [{ timestamp: Date.now(), processedCount: 0 }]
});
var logMessage = (context, message, details) => {
  context.activityLog.push({
    type: "message",
    timestamp: currentTimestamp(),
    message,
    ...details ? { details } : {}
  });
};
var recordEntitySummary = (context, summary) => {
  const entry = {
    type: "summary",
    timestamp: currentTimestamp(),
    ...summary
  };
  context.activityLog.push(entry);
  const existing = context.entityProgress[summary.entity];
  const processedTotal = summary.created + summary.mapped;
  if (existing) {
    const previousProcessed = existing.created + existing.mapped;
    existing.total = summary.total;
    existing.created = summary.created;
    existing.mapped = summary.mapped;
    const delta = processedTotal - previousProcessed;
    if (delta > 0) {
      context.processedCount += delta;
    }
  } else {
    context.entityProgress[summary.entity] = {
      total: summary.total,
      created: summary.created,
      mapped: summary.mapped
    };
    context.processedCount += processedTotal;
  }
};
var PROGRESS_UPDATE_INTERVAL2 = 500;
var REPOSITORY_CASE_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_REPOSITORY_CASE_CHUNK_SIZE,
  500
);
var TEST_RUN_CASE_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_TEST_RUN_CASE_CHUNK_SIZE,
  500
);
var AUTOMATION_CASE_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_CASE_CHUNK_SIZE,
  500
);
var AUTOMATION_RUN_TEST_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_TEST_CHUNK_SIZE,
  2e3
);
var AUTOMATION_RUN_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_CHUNK_SIZE,
  500
);
var AUTOMATION_RUN_FIELD_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_FIELD_CHUNK_SIZE,
  500
);
var AUTOMATION_RUN_LINK_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_LINK_CHUNK_SIZE,
  500
);
var AUTOMATION_RUN_TEST_FIELD_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_TEST_FIELD_CHUNK_SIZE,
  500
);
var AUTOMATION_RUN_TAG_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_TAG_CHUNK_SIZE,
  500
);
var TEST_RUN_RESULT_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_TEST_RUN_RESULT_CHUNK_SIZE,
  2e3
);
var ISSUE_RELATIONSHIP_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_ISSUE_RELATIONSHIP_CHUNK_SIZE,
  1e3
);
var REPOSITORY_FOLDER_TRANSACTION_TIMEOUT_MS = parseNumberEnv(
  process.env.TESTMO_REPOSITORY_FOLDER_TRANSACTION_TIMEOUT_MS,
  2 * 60 * 1e3
);
var initializeEntityProgress = (context, entity, total) => {
  if (total <= 0) {
    return;
  }
  const existing = context.entityProgress[entity];
  if (existing) {
    existing.total = total;
  } else {
    context.entityProgress[entity] = {
      total,
      created: 0,
      mapped: 0
    };
  }
};
var incrementEntityProgress = (context, entity, createdIncrement = 0, mappedIncrement = 0) => {
  const totalIncrement = createdIncrement + mappedIncrement;
  if (totalIncrement === 0) {
    return;
  }
  const entry = context.entityProgress[entity] ?? (context.entityProgress[entity] = {
    total: totalIncrement,
    created: 0,
    mapped: 0
  });
  entry.created += createdIncrement;
  entry.mapped += mappedIncrement;
  context.processedCount += totalIncrement;
};
var decrementEntityTotal = (context, entity) => {
  const entry = context.entityProgress[entity];
  if (entry && entry.total > 0) {
    entry.total -= 1;
  }
};
var formatInProgressStatus = (context, entity) => {
  const entry = context.entityProgress[entity];
  if (!entry) {
    return void 0;
  }
  const processed = entry.created + entry.mapped;
  return `${processed.toLocaleString()} / ${entry.total.toLocaleString()} processed`;
};
var calculateProgressMetrics = (context, totalCount) => {
  const now = Date.now();
  const elapsedMs = now - context.startTime;
  const elapsedSeconds = elapsedMs / 1e3;
  if (elapsedSeconds < 2 || context.processedCount === 0 || totalCount === 0) {
    console.log(
      `[calculateProgressMetrics] Skipping - elapsed: ${elapsedSeconds.toFixed(1)}s, processed: ${context.processedCount}, total: ${totalCount}`
    );
    return { estimatedTimeRemaining: null, processingRate: null };
  }
  const itemsPerSecond = getSmoothedProcessingRate(
    context,
    now,
    elapsedSeconds
  );
  const remainingCount = totalCount - context.processedCount;
  const estimatedSecondsRemaining = remainingCount / itemsPerSecond;
  const processingRate = itemsPerSecond >= 1 ? `${itemsPerSecond.toFixed(1)} items/sec` : `${(itemsPerSecond * 60).toFixed(1)} items/min`;
  const estimatedTimeRemaining = Math.ceil(
    estimatedSecondsRemaining
  ).toString();
  console.log(
    `[calculateProgressMetrics] Calculated - processed: ${context.processedCount}/${totalCount}, elapsed: ${elapsedSeconds.toFixed(1)}s, rate: ${processingRate}, ETA: ${estimatedTimeRemaining}s`
  );
  return { estimatedTimeRemaining, processingRate };
};
var MAX_RECENT_PROGRESS_ENTRIES = 60;
var RECENT_PROGRESS_WINDOW_MS = 6e4;
var EMA_ALPHA = 0.3;
var getSmoothedProcessingRate = (context, now, elapsedSeconds) => {
  const recent = context.recentProgress;
  const lastEntry = recent[recent.length - 1];
  if (lastEntry.timestamp !== now || lastEntry.processedCount !== context.processedCount) {
    recent.push({ timestamp: now, processedCount: context.processedCount });
  }
  while (recent.length > MAX_RECENT_PROGRESS_ENTRIES || recent.length > 1 && now - recent[1].timestamp > RECENT_PROGRESS_WINDOW_MS) {
    recent.shift();
  }
  if (recent.length < 2) {
    return context.processedCount / elapsedSeconds;
  }
  let smoothedRate = null;
  for (let i = 1; i < recent.length; i += 1) {
    const prev = recent[i - 1];
    const current = recent[i];
    if (current.timestamp <= prev.timestamp) {
      continue;
    }
    const deltaCount = current.processedCount - prev.processedCount;
    if (deltaCount <= 0) {
      continue;
    }
    const deltaSeconds = (current.timestamp - prev.timestamp) / 1e3;
    if (deltaSeconds <= 0) {
      continue;
    }
    const instantaneousRate = deltaCount / deltaSeconds;
    if (Number.isFinite(instantaneousRate) && instantaneousRate > 0) {
      smoothedRate = smoothedRate === null ? instantaneousRate : EMA_ALPHA * instantaneousRate + (1 - EMA_ALPHA) * smoothedRate;
    }
  }
  if (smoothedRate === null || !Number.isFinite(smoothedRate)) {
    smoothedRate = context.processedCount / elapsedSeconds;
  }
  const totalRate = context.processedCount / elapsedSeconds;
  return Math.max(smoothedRate, totalRate * 0.2);
};
var computeEntityTotals = (configuration, datasetRows, datasetRowCounts) => {
  const totals = /* @__PURE__ */ new Map();
  const countConfigEntries = (entries) => Object.values(entries ?? {}).filter(
    (entry) => entry !== void 0 && entry !== null
  ).length;
  totals.set("workflows", countConfigEntries(configuration.workflows));
  totals.set("statuses", countConfigEntries(configuration.statuses));
  totals.set("groups", countConfigEntries(configuration.groups));
  totals.set("roles", countConfigEntries(configuration.roles));
  totals.set(
    "milestoneTypes",
    countConfigEntries(configuration.milestoneTypes)
  );
  totals.set(
    "configurations",
    countConfigEntries(configuration.configurations)
  );
  totals.set("templates", countConfigEntries(configuration.templates));
  totals.set(
    "templateFields",
    countConfigEntries(configuration.templateFields)
  );
  totals.set("tags", countConfigEntries(configuration.tags));
  totals.set("users", countConfigEntries(configuration.users));
  const datasetCount = (name) => datasetRowCounts.get(name) ?? 0;
  totals.set("userGroups", datasetCount("user_groups"));
  totals.set("projects", datasetCount("projects"));
  totals.set("milestones", datasetCount("milestones"));
  totals.set("sessions", datasetCount("sessions"));
  totals.set("sessionResults", datasetCount("session_results"));
  totals.set("repositories", datasetCount("repositories"));
  totals.set("repositoryFolders", datasetCount("repository_folders"));
  totals.set("repositoryCases", datasetCount("repository_cases"));
  totals.set("repositoryCaseTags", datasetCount("repository_case_tags"));
  totals.set("automationCases", datasetCount("automation_cases"));
  totals.set("automationRuns", datasetCount("automation_runs"));
  totals.set("automationRunTests", datasetCount("automation_run_tests"));
  totals.set("automationRunFields", datasetCount("automation_run_fields"));
  totals.set("automationRunLinks", datasetCount("automation_run_links"));
  totals.set(
    "automationRunTestFields",
    datasetCount("automation_run_test_fields")
  );
  totals.set("automationRunTags", datasetCount("automation_run_tags"));
  totals.set("testRuns", datasetCount("runs"));
  totals.set("testRunCases", datasetCount("run_tests"));
  totals.set("testRunResults", datasetCount("run_results"));
  totals.set("testRunStepResults", datasetCount("run_result_steps"));
  totals.set("runTags", datasetCount("run_tags"));
  totals.set("sessionTags", datasetCount("session_tags"));
  totals.set("issueTargets", datasetCount("issue_targets"));
  totals.set("issues", datasetCount("issues"));
  totals.set("milestoneIssues", datasetCount("milestone_issues"));
  totals.set("repositoryCaseIssues", datasetCount("repository_case_issues"));
  totals.set("runIssues", datasetCount("run_issues"));
  totals.set("runResultIssues", datasetCount("run_result_issues"));
  totals.set("sessionIssues", datasetCount("session_issues"));
  totals.set("sessionResultIssues", datasetCount("session_result_issues"));
  totals.set("projectIntegrations", 0);
  return totals;
};
var releaseDatasetRows = (datasetRows, ...names) => {
  for (const name of names) {
    datasetRows.delete(name);
  }
};
var normalizeEstimate = (value) => {
  if (value === null || !Number.isFinite(value)) {
    return { value: null, adjustment: null };
  }
  const rounded = Math.round(value);
  if (Math.abs(rounded) <= MAX_INT_32) {
    return { value: rounded, adjustment: null };
  }
  const scaleCandidates = [
    { factor: 1e6, adjustment: "microseconds" },
    { factor: 1e9, adjustment: "nanoseconds" },
    { factor: 1e3, adjustment: "milliseconds" }
  ];
  for (const candidate of scaleCandidates) {
    const scaled = Math.round(value / candidate.factor);
    if (Math.abs(scaled) <= MAX_INT_32) {
      return { value: scaled, adjustment: candidate.adjustment };
    }
  }
  return {
    value: value > 0 ? MAX_INT_32 : MIN_INT_32,
    adjustment: "clamped"
  };
};
var generateSystemName2 = (value) => {
  const normalized = value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/^[^a-z]+/, "");
  return normalized || "status";
};
var normalizeColorHex = (value) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
};
var isCanonicalRepository = (projectSourceId, repoSourceId, canonicalRepoIdByProject) => {
  if (repoSourceId === null) {
    return true;
  }
  if (projectSourceId === null) {
    return true;
  }
  const canonicalRepoIds = canonicalRepoIdByProject.get(projectSourceId);
  if (!canonicalRepoIds || canonicalRepoIds.size === 0) {
    return true;
  }
  return canonicalRepoIds.has(repoSourceId);
};
var getPreferredRepositoryId = (projectSourceId, repoSourceId, canonicalRepoIdByProject) => {
  if (projectSourceId === null) {
    return null;
  }
  const canonicalRepoIds = canonicalRepoIdByProject.get(projectSourceId);
  if (!canonicalRepoIds || canonicalRepoIds.size === 0) {
    return repoSourceId;
  }
  const iterator = canonicalRepoIds.values().next();
  const primaryRepoId = iterator.done ? null : iterator.value ?? null;
  if (primaryRepoId === null) {
    return repoSourceId;
  }
  return primaryRepoId;
};
var TIPTAP_EXTENSIONS2 = [
  import_starter_kit2.default.configure({
    dropcursor: false,
    gapcursor: false,
    undoRedo: false,
    trailingNode: false,
    heading: {
      levels: [1, 2, 3, 4]
    }
  })
];
var sharedHappyDOMWindow2 = null;
var sharedDOMParser2 = null;
var conversionsSinceCleanup = 0;
var CLEANUP_INTERVAL = 1e3;
function getSharedHappyDOM2() {
  if (!sharedHappyDOMWindow2 || !sharedDOMParser2 || conversionsSinceCleanup >= CLEANUP_INTERVAL) {
    if (sharedHappyDOMWindow2) {
      try {
        sharedHappyDOMWindow2.close();
      } catch (e) {
      }
    }
    sharedHappyDOMWindow2 = new import_happy_dom2.Window();
    sharedDOMParser2 = new sharedHappyDOMWindow2.DOMParser();
    conversionsSinceCleanup = 0;
  }
  conversionsSinceCleanup++;
  return { window: sharedHappyDOMWindow2, parser: sharedDOMParser2 };
}
function generateJSONOptimized(html, extensions, options) {
  const { parser: parser2 } = getSharedHappyDOM2();
  const schema = (0, import_core2.getSchema)(extensions);
  const htmlString = `<!DOCTYPE html><html><body>${html}</body></html>`;
  const doc = parser2.parseFromString(htmlString, "text/html");
  if (!doc) {
    throw new Error("Failed to parse HTML string");
  }
  return import_model2.DOMParser.fromSchema(schema).parse(doc.body, options).toJSON();
}
var isTipTapDocument = (value) => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const doc = value;
  if (doc.type !== "doc") {
    return false;
  }
  if (!("content" in doc)) {
    return true;
  }
  return Array.isArray(doc.content);
};
var TIPTAP_CACHE_LIMIT = 100;
var tipTapConversionCache = /* @__PURE__ */ new Map();
var getCachedTipTapDocument = (key) => tipTapConversionCache.get(key);
var cacheTipTapDocument = (key, doc) => {
  if (tipTapConversionCache.has(key)) {
    tipTapConversionCache.set(key, doc);
    return;
  }
  if (tipTapConversionCache.size >= TIPTAP_CACHE_LIMIT) {
    tipTapConversionCache.clear();
  }
  tipTapConversionCache.set(key, doc);
};
var clearTipTapCache = () => tipTapConversionCache.clear();
var createParagraphDocument = (text) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return emptyEditorContent;
  }
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text
          }
        ]
      }
    ]
  };
  return doc;
};
var convertToTipTapDocument = (value) => {
  if (value === null || value === void 0) {
    return null;
  }
  if (isTipTapDocument(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return emptyEditorContent;
    }
    const cachedDoc = getCachedTipTapDocument(trimmed);
    if (cachedDoc) {
      return cachedDoc;
    }
    let candidate;
    try {
      const parsed = JSON.parse(trimmed);
      if (isTipTapDocument(parsed)) {
        candidate = parsed;
      }
    } catch {
    }
    if (!candidate) {
      try {
        const generated = generateJSONOptimized(trimmed, TIPTAP_EXTENSIONS2);
        if (isTipTapDocument(generated)) {
          candidate = generated;
        }
      } catch {
      }
    }
    if (!candidate) {
      candidate = createParagraphDocument(trimmed);
    }
    cacheTipTapDocument(trimmed, candidate);
    return candidate;
  }
  if (typeof value === "object") {
    try {
      const parsed = JSON.parse(JSON.stringify(value));
      if (isTipTapDocument(parsed)) {
        return parsed;
      }
    } catch {
    }
  }
  return createParagraphDocument(String(value));
};
var isTipTapDocumentEmpty = (doc) => {
  const content = Array.isArray(doc.content) ? doc.content : [];
  if (content.length === 0) {
    return true;
  }
  if (content.length === 1) {
    const first = content[0];
    const children = Array.isArray(first?.content) ? first?.content : [];
    if (children.length === 0) {
      const text = typeof first?.text === "string" ? first.text.trim() : "";
      return text.length === 0;
    }
    if (children.length === 1) {
      const child = children[0];
      if (typeof child?.text === "string" && child.text.trim().length === 0) {
        return true;
      }
    }
  }
  return false;
};
var convertToTipTapJsonValue = (value) => {
  const doc = convertToTipTapDocument(value);
  if (!doc || isTipTapDocumentEmpty(doc)) {
    return null;
  }
  return doc;
};
var convertToTipTapJsonString = (value) => {
  const doc = convertToTipTapDocument(value);
  if (!doc || isTipTapDocumentEmpty(doc)) {
    return null;
  }
  return JSON.stringify(doc);
};
var parseBooleanValue = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return ["1", "true", "yes", "y", "on"].includes(normalized);
  }
  return Boolean(value);
};
var parseIntegerValue = (value) => {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
};
var parseFloatValue = (value) => {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
var parseDateValueToISOString = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const candidates = [
    trimmed,
    trimmed.replace(/ /g, "T"),
    `${trimmed.replace(/ /g, "T")}Z`
  ];
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
};
var normalizeDropdownValue = (value, metadata, logWarning) => {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  if (typeof value === "number" && metadata.optionIds.has(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && metadata.optionIds.has(numeric)) {
      return numeric;
    }
    const optionIdByName = metadata.optionsByName.get(trimmed.toLowerCase());
    if (optionIdByName !== void 0) {
      return optionIdByName;
    }
    logWarning("Unrecognized dropdown option", {
      field: metadata.systemName,
      displayName: metadata.displayName,
      value,
      availableOptions: Array.from(metadata.optionsByName.keys())
    });
    return null;
  }
  if (typeof value === "object") {
    const serialized = String(value);
    return normalizeDropdownValue(serialized, metadata, logWarning);
  }
  return null;
};
var convertToArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
    }
    return trimmed.split(/[;,|]/g).map((entry) => entry.trim()).filter(Boolean);
  }
  return [value];
};
var normalizeMultiSelectValue = (value, metadata, logWarning) => {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const entries = convertToArray(value);
  const optionIds = [];
  for (const entry of entries) {
    if (entry === null || entry === void 0 || entry === "") {
      continue;
    }
    if (typeof entry === "number" && metadata.optionIds.has(entry)) {
      optionIds.push(entry);
      continue;
    }
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && metadata.optionIds.has(numeric)) {
        optionIds.push(numeric);
        continue;
      }
      const optionIdByName = metadata.optionsByName.get(trimmed.toLowerCase());
      if (optionIdByName !== void 0) {
        optionIds.push(optionIdByName);
        continue;
      }
      logWarning("Unrecognized multi-select option", {
        field: metadata.systemName,
        displayName: metadata.displayName,
        value: trimmed,
        availableOptions: Array.from(metadata.optionsByName.keys())
      });
      continue;
    }
    logWarning("Unsupported multi-select option value", {
      field: metadata.systemName,
      displayName: metadata.displayName,
      value: entry,
      entryType: typeof entry
    });
  }
  return optionIds.length > 0 ? Array.from(new Set(optionIds)) : null;
};
var normalizeCaseFieldValue = (value, metadata, logWarning, testmoFieldValueMap) => {
  if (value === null || value === void 0) {
    return null;
  }
  const fieldType = metadata.type.toLowerCase();
  if (fieldType.includes("text long") || fieldType.includes("text (long)")) {
    const jsonValue = convertToTipTapJsonValue(value);
    if (jsonValue === null) {
      return null;
    }
    return JSON.stringify(jsonValue);
  }
  if (fieldType.includes("text string") || fieldType === "string") {
    return String(value);
  }
  if (fieldType === "integer") {
    return parseIntegerValue(value);
  }
  if (fieldType === "number") {
    return parseFloatValue(value);
  }
  if (fieldType === "checkbox") {
    return parseBooleanValue(value);
  }
  if (fieldType === "dropdown") {
    if (typeof value === "number" && testmoFieldValueMap) {
      const testmoFieldValue = testmoFieldValueMap.get(value);
      if (testmoFieldValue) {
        const result2 = normalizeDropdownValue(
          testmoFieldValue.name,
          metadata,
          logWarning
        );
        return result2;
      }
    }
    const result = normalizeDropdownValue(value, metadata, logWarning);
    return result;
  }
  const normalizedType = fieldType.replace(/\s+/g, "-");
  if (normalizedType === "multi-select") {
    if (testmoFieldValueMap && testmoFieldValueMap.size > 0) {
      const processedValue = Array.isArray(value) ? value : [value];
      const resolvedValues = processedValue.map((v) => {
        if (typeof v === "number") {
          const testmoFieldValue = testmoFieldValueMap.get(v);
          if (testmoFieldValue) {
            return testmoFieldValue.name;
          } else {
            return v;
          }
        }
        return v;
      });
      const result2 = normalizeMultiSelectValue(
        resolvedValues,
        metadata,
        logWarning
      );
      return result2;
    }
    const result = normalizeMultiSelectValue(value, metadata, logWarning);
    return result;
  }
  if (fieldType === "date") {
    return parseDateValueToISOString(value);
  }
  if (fieldType === "link") {
    return String(value);
  }
  if (fieldType === "steps") {
    return void 0;
  }
  return value;
};
async function importUsers(tx, configuration, importJob) {
  const summary = {
    entity: "users",
    total: 0,
    created: 0,
    mapped: 0
  };
  const validAccessValues = new Set(Object.values(import_client5.Access));
  const resolveAccess = (value) => {
    if (value && validAccessValues.has(value)) {
      return value;
    }
    return import_client5.Access.USER;
  };
  const ensureRoleExists = async (roleId) => {
    const role = await tx.roles.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new Error(`Role ${roleId} selected for a user does not exist.`);
    }
  };
  const resolveRoleId = async (configRoleId) => {
    if (configRoleId && Number.isFinite(configRoleId)) {
      await ensureRoleExists(configRoleId);
      return configRoleId;
    }
    const defaultRole = await tx.roles.findFirst({
      where: { isDefault: true }
    });
    if (!defaultRole) {
      throw new Error("No default role is configured. Unable to create users.");
    }
    return defaultRole.id;
  };
  for (const [key, config] of Object.entries(configuration.users ?? {})) {
    const userId = Number(key);
    if (!Number.isFinite(userId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (!config.mappedTo) {
        throw new Error(
          `User ${userId} is configured to map but no target user was provided.`
        );
      }
      const existing = await tx.user.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing) {
        throw new Error(
          `User ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }
    const email = (config.email ?? "").trim().toLowerCase();
    if (!email) {
      throw new Error(
        `User ${userId} requires an email address before creation.`
      );
    }
    const existingByEmail = await tx.user.findUnique({ where: { email } });
    if (existingByEmail) {
      config.action = "map";
      config.mappedTo = existingByEmail.id;
      config.email = existingByEmail.email;
      config.name = existingByEmail.name;
      config.access = existingByEmail.access;
      config.roleId = existingByEmail.roleId;
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim() || email;
    const access = resolveAccess(config.access ?? null);
    const roleId = await resolveRoleId(config.roleId ?? null);
    const isActive = config.isActive ?? true;
    const isApi = config.isApi ?? false;
    const password = config.password ?? generateRandomPassword();
    const hashedPassword = await import_bcrypt.default.hash(password, 10);
    const created = await tx.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        access,
        roleId,
        isActive,
        isApi,
        emailVerified: /* @__PURE__ */ new Date(),
        createdById: importJob.createdById
      }
    });
    config.action = "map";
    config.mappedTo = created.id;
    config.password = null;
    config.name = created.name;
    config.email = created.email;
    config.access = created.access;
    config.roleId = created.roleId;
    config.isActive = created.isActive;
    config.isApi = created.isApi;
    summary.created += 1;
  }
  return summary;
}
var importProjects = async (tx, datasetRows, importJob, userIdMap, statusIdMap, workflowIdMap, milestoneTypeIdMap, templateIdMap, templateMap, context, persistProgress) => {
  const projectRows = datasetRows.get("projects") ?? [];
  const summary = {
    entity: "projects",
    total: 0,
    created: 0,
    mapped: 0
  };
  const projectIdMap = /* @__PURE__ */ new Map();
  const defaultTemplateIdByProject = /* @__PURE__ */ new Map();
  if (projectRows.length === 0) {
    logMessage(context, "No projects dataset found; skipping project import.");
    return { summary, projectIdMap, defaultTemplateIdByProject };
  }
  initializeEntityProgress(context, "projects", projectRows.length);
  let processedSinceLastPersist = 0;
  const templateIdsToAssign = new Set(templateIdMap.values());
  for (const templateId of templateMap.values()) {
    templateIdsToAssign.add(templateId);
  }
  const defaultTemplateRecord = await tx.templates.findFirst({
    where: {
      isDefault: true,
      isDeleted: false
    },
    select: { id: true }
  });
  if (defaultTemplateRecord?.id) {
    templateIdsToAssign.add(defaultTemplateRecord.id);
  }
  const workflowIdsToAssign = new Set(workflowIdMap.values());
  const defaultCaseWorkflow = await tx.workflows.findFirst({
    where: {
      isDefault: true,
      isDeleted: false,
      scope: import_client5.WorkflowScope.CASES
    },
    select: { id: true }
  });
  if (defaultCaseWorkflow?.id) {
    workflowIdsToAssign.add(defaultCaseWorkflow.id);
  }
  const milestoneTypeIdsToAssign = new Set(milestoneTypeIdMap.values());
  const defaultMilestoneType = await tx.milestoneTypes.findFirst({
    where: {
      isDefault: true,
      isDeleted: false
    },
    select: { id: true }
  });
  if (defaultMilestoneType?.id) {
    milestoneTypeIdsToAssign.add(defaultMilestoneType.id);
  }
  for (const row of projectRows) {
    const record = row;
    const sourceId = toNumberValue(record.id);
    if (sourceId === null) {
      continue;
    }
    const name = toStringValue2(record.name) ?? `Imported Project ${sourceId}`;
    const existing = await tx.projects.findUnique({ where: { name } });
    let projectId;
    if (existing) {
      projectId = existing.id;
      projectIdMap.set(sourceId, projectId);
      summary.total += 1;
      summary.mapped += 1;
      incrementEntityProgress(context, "projects", 0, 1);
      processedSinceLastPersist += 1;
    } else {
      const createdBy = resolveUserId(
        userIdMap,
        importJob.createdById,
        record.created_by
      );
      const createdAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
      const completedAt = toDateValue(record.completed_at);
      const note = toStringValue2(record.note);
      const docs = toStringValue2(record.docs);
      const isCompleted = toBooleanValue(record.is_completed);
      const project = await tx.projects.create({
        data: {
          name,
          note: note ?? null,
          docs: docs ?? null,
          isCompleted,
          createdBy,
          createdAt,
          completedAt: completedAt ?? void 0
        }
      });
      projectId = project.id;
      projectIdMap.set(sourceId, project.id);
      summary.total += 1;
      summary.created += 1;
      incrementEntityProgress(context, "projects", 1, 0);
      processedSinceLastPersist += 1;
    }
    if (statusIdMap.size > 0) {
      const statusAssignments = Array.from(statusIdMap.values()).map(
        (statusId) => ({
          projectId,
          statusId
        })
      );
      await tx.projectStatusAssignment.createMany({
        data: statusAssignments,
        skipDuplicates: true
      });
    }
    if (workflowIdsToAssign.size > 0) {
      const workflowAssignments = Array.from(workflowIdsToAssign).map(
        (workflowId) => ({
          projectId,
          workflowId
        })
      );
      await tx.projectWorkflowAssignment.createMany({
        data: workflowAssignments,
        skipDuplicates: true
      });
    }
    if (milestoneTypeIdsToAssign.size > 0) {
      const milestoneAssignments = Array.from(milestoneTypeIdsToAssign).map(
        (milestoneTypeId) => ({
          projectId,
          milestoneTypeId
        })
      );
      await tx.milestoneTypesAssignment.createMany({
        data: milestoneAssignments,
        skipDuplicates: true
      });
    }
    if (templateIdsToAssign.size > 0) {
      const templateAssignments = Array.from(templateIdsToAssign).map(
        (templateId) => ({
          templateId,
          projectId
        })
      );
      await tx.templateProjectAssignment.createMany({
        data: templateAssignments,
        skipDuplicates: true
      });
    }
    let resolvedDefaultTemplateId = null;
    if (defaultTemplateRecord?.id) {
      resolvedDefaultTemplateId = defaultTemplateRecord.id;
    } else {
      const fallbackAssignment = await tx.templateProjectAssignment.findFirst({
        where: { projectId },
        select: { templateId: true },
        orderBy: { templateId: "asc" }
      });
      resolvedDefaultTemplateId = fallbackAssignment?.templateId ?? null;
    }
    if (!resolvedDefaultTemplateId) {
      const fallbackTemplate = await tx.templates.findFirst({
        where: { isDeleted: false },
        select: { id: true },
        orderBy: { id: "asc" }
      });
      if (fallbackTemplate?.id) {
        try {
          await tx.templateProjectAssignment.create({
            data: {
              projectId,
              templateId: fallbackTemplate.id
            }
          });
        } catch (error) {
        }
        resolvedDefaultTemplateId = fallbackTemplate.id;
      }
    }
    defaultTemplateIdByProject.set(projectId, resolvedDefaultTemplateId);
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
      const message = formatInProgressStatus(context, "projects");
      await persistProgress("projects", message);
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "projects");
    await persistProgress("projects", message);
  }
  return { summary, projectIdMap, defaultTemplateIdByProject };
};
var importMilestones = async (tx, datasetRows, projectIdMap, milestoneTypeIdMap, userIdMap, importJob, context, persistProgress) => {
  const milestoneRows = datasetRows.get("milestones") ?? [];
  const summary = {
    entity: "milestones",
    total: 0,
    created: 0,
    mapped: 0
  };
  const milestoneIdMap = /* @__PURE__ */ new Map();
  if (milestoneRows.length === 0) {
    logMessage(
      context,
      "No milestones dataset found; skipping milestone import."
    );
    return { summary, milestoneIdMap };
  }
  initializeEntityProgress(context, "milestones", milestoneRows.length);
  let processedSinceLastPersist = 0;
  const defaultMilestoneType = await tx.milestoneTypes.findFirst({
    where: { isDefault: true },
    select: { id: true }
  });
  const fallbackMilestoneTypeId = defaultMilestoneType?.id ?? null;
  const pendingRelations = [];
  for (const row of milestoneRows) {
    const record = row;
    const sourceId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    const typeSourceId = toNumberValue(record.type_id);
    if (sourceId === null || projectSourceId === null) {
      continue;
    }
    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(context, "Skipping milestone due to missing project mapping", {
        sourceId,
        projectSourceId
      });
      decrementEntityTotal(context, "milestones");
      continue;
    }
    const resolvedMilestoneTypeId = typeSourceId !== null ? milestoneTypeIdMap.get(typeSourceId) ?? fallbackMilestoneTypeId : fallbackMilestoneTypeId;
    if (!resolvedMilestoneTypeId) {
      logMessage(
        context,
        "Skipping milestone due to missing milestone type mapping",
        {
          sourceId,
          typeSourceId
        }
      );
      decrementEntityTotal(context, "milestones");
      continue;
    }
    const name = toStringValue2(record.name) ?? `Imported Milestone ${sourceId}`;
    const note = convertToTipTapJsonString(record.note);
    const docs = convertToTipTapJsonString(record.docs);
    const isStarted = toBooleanValue(record.is_started);
    const isCompleted = toBooleanValue(record.is_completed);
    const startedAt = toDateValue(record.started_at);
    const completedAt = toDateValue(record.completed_at);
    const createdAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
    const createdBy = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );
    const existingMilestone = await tx.milestones.findFirst({
      where: {
        projectId,
        name,
        isDeleted: false
      }
    });
    if (existingMilestone) {
      milestoneIdMap.set(sourceId, existingMilestone.id);
      summary.total += 1;
      summary.mapped += 1;
      incrementEntityProgress(context, "milestones", 0, 1);
      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
        const message = formatInProgressStatus(context, "milestones");
        await persistProgress("milestones", message);
        processedSinceLastPersist = 0;
      }
      continue;
    }
    const milestone = await tx.milestones.create({
      data: {
        projectId,
        milestoneTypesId: resolvedMilestoneTypeId,
        name,
        note: note ?? void 0,
        docs: docs ?? void 0,
        isStarted,
        isCompleted,
        startedAt: startedAt ?? void 0,
        completedAt: completedAt ?? void 0,
        createdAt,
        createdBy
      }
    });
    milestoneIdMap.set(sourceId, milestone.id);
    pendingRelations.push({
      milestoneId: milestone.id,
      parentSourceId: toNumberValue(record.parent_id),
      rootSourceId: toNumberValue(record.root_id)
    });
    summary.total += 1;
    summary.created += 1;
    incrementEntityProgress(context, "milestones", 1, 0);
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
      const message = formatInProgressStatus(context, "milestones");
      await persistProgress("milestones", message);
      processedSinceLastPersist = 0;
    }
  }
  for (const relation of pendingRelations) {
    const parentId = relation.parentSourceId !== null ? milestoneIdMap.get(relation.parentSourceId) ?? null : null;
    const rootId = relation.rootSourceId !== null ? milestoneIdMap.get(relation.rootSourceId) ?? null : null;
    if (parentId !== null || rootId !== null) {
      await tx.milestones.update({
        where: { id: relation.milestoneId },
        data: {
          parentId: parentId ?? void 0,
          rootId: rootId ?? void 0
        }
      });
    }
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "milestones");
    await persistProgress("milestones", message);
  }
  return { summary, milestoneIdMap };
};
var importSessions = async (tx, datasetRows, projectIdMap, milestoneIdMap, configurationIdMap, workflowIdMap, userIdMap, templateIdMap, importJob, context, persistProgress) => {
  const sessionRows = datasetRows.get("sessions") ?? [];
  const summary = {
    entity: "sessions",
    total: 0,
    created: 0,
    mapped: 0
  };
  const sessionIdMap = /* @__PURE__ */ new Map();
  if (sessionRows.length === 0) {
    logMessage(context, "No sessions dataset found; skipping session import.");
    return { summary, sessionIdMap };
  }
  initializeEntityProgress(context, "sessions", sessionRows.length);
  let processedSinceLastPersist = 0;
  const defaultTemplate = await tx.templates.findFirst({
    where: {
      OR: [
        { templateName: "Exploratory" },
        { isDefault: true },
        { isEnabled: true }
      ],
      isDeleted: false
    },
    select: { id: true }
  });
  const defaultWorkflowState = await tx.workflows.findFirst({
    where: {
      scope: import_client5.WorkflowScope.SESSIONS,
      isDeleted: false
    },
    select: { id: true }
  });
  for (const row of sessionRows) {
    const record = row;
    const sourceId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    const templateSourceId = toNumberValue(record.template_id);
    const stateSourceId = toNumberValue(record.state_id);
    if (sourceId === null || projectSourceId === null) {
      continue;
    }
    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(context, "Skipping session due to missing project mapping", {
        sourceId,
        projectSourceId
      });
      decrementEntityTotal(context, "sessions");
      continue;
    }
    let resolvedTemplateId = defaultTemplate?.id;
    if (templateSourceId !== null && templateIdMap.has(templateSourceId)) {
      resolvedTemplateId = templateIdMap.get(templateSourceId);
    }
    if (!resolvedTemplateId) {
      logMessage(context, "Skipping session due to missing template", {
        sourceId,
        templateSourceId
      });
      decrementEntityTotal(context, "sessions");
      continue;
    }
    let resolvedStateId = defaultWorkflowState?.id;
    if (stateSourceId !== null && workflowIdMap.has(stateSourceId)) {
      resolvedStateId = workflowIdMap.get(stateSourceId);
    }
    if (!resolvedStateId) {
      logMessage(context, "Skipping session due to missing workflow state", {
        sourceId,
        stateSourceId
      });
      decrementEntityTotal(context, "sessions");
      continue;
    }
    const name = toStringValue2(record.name) ?? `Imported Session ${sourceId}`;
    const note = convertToTipTapJsonString(record.note);
    const mission = convertToTipTapJsonString(record.custom_mission);
    const estimateRaw = toNumberValue(record.estimate);
    const estimate = estimateRaw !== null ? Math.floor(estimateRaw / 1e6) : null;
    const forecastRaw = toNumberValue(record.forecast);
    const forecast = forecastRaw !== null ? Math.floor(forecastRaw / 1e6) : null;
    const elapsedRaw = toNumberValue(record.elapsed);
    const elapsed = elapsedRaw !== null ? Math.floor(elapsedRaw / 1e6) : null;
    const isCompleted = toBooleanValue(record.is_closed);
    const completedAt = isCompleted ? toDateValue(record.closed_at) : null;
    const createdAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
    const createdBy = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );
    const milestoneSourceId = toNumberValue(record.milestone_id);
    let milestoneId = null;
    if (milestoneSourceId !== null) {
      milestoneId = milestoneIdMap.get(milestoneSourceId) ?? null;
    }
    const configSourceId = toNumberValue(record.config_id);
    let configId = null;
    if (configSourceId !== null) {
      configId = configurationIdMap.get(configSourceId) ?? null;
    }
    const assigneeSourceId = toNumberValue(record.assignee_id);
    let assignedToId = null;
    if (assigneeSourceId !== null) {
      assignedToId = userIdMap.get(assigneeSourceId) ?? null;
    }
    const existingSession = await tx.sessions.findFirst({
      where: {
        projectId,
        name,
        isDeleted: false
      },
      select: { id: true }
    });
    let sessionId;
    if (existingSession) {
      sessionId = existingSession.id;
      summary.mapped += 1;
      incrementEntityProgress(context, "sessions", 0, 1);
    } else {
      const session = await tx.sessions.create({
        data: {
          projectId,
          templateId: resolvedTemplateId,
          name,
          note: note ?? void 0,
          mission: mission ?? void 0,
          configId,
          milestoneId,
          stateId: resolvedStateId,
          assignedToId,
          estimate,
          forecastManual: forecast,
          elapsed,
          isCompleted,
          completedAt,
          createdAt,
          createdById: createdBy
        }
      });
      sessionId = session.id;
      summary.created += 1;
      incrementEntityProgress(context, "sessions", 1, 0);
      const projectName = await getProjectName2(tx, projectId);
      const templateName = await getTemplateName2(tx, resolvedTemplateId);
      const workflowName = await getWorkflowName2(tx, resolvedStateId);
      const configurationName = configId ? await getConfigurationName(tx, configId) : null;
      const milestoneNameResolved = milestoneId ? await getMilestoneName(tx, milestoneId) : null;
      const assignedToNameResolved = assignedToId ? await getUserName2(tx, assignedToId) : null;
      const createdByName = await getUserName2(tx, createdBy);
      await tx.sessionVersions.create({
        data: {
          session: { connect: { id: session.id } },
          name,
          staticProjectId: projectId,
          staticProjectName: projectName,
          project: { connect: { id: projectId } },
          templateId: resolvedTemplateId,
          templateName,
          configId: configId ?? null,
          configurationName,
          milestoneId: milestoneId ?? null,
          milestoneName: milestoneNameResolved,
          stateId: resolvedStateId,
          stateName: workflowName,
          assignedToId: assignedToId ?? null,
          assignedToName: assignedToNameResolved,
          createdById: createdBy,
          createdByName,
          estimate,
          forecastManual: forecast,
          forecastAutomated: null,
          elapsed,
          note: note ?? JSON.stringify(emptyEditorContent),
          mission: mission ?? JSON.stringify(emptyEditorContent),
          isCompleted,
          completedAt,
          version: session.currentVersion ?? 1,
          tags: JSON.stringify([]),
          attachments: JSON.stringify([]),
          issues: JSON.stringify([])
        }
      });
    }
    sessionIdMap.set(sourceId, sessionId);
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
      const message = formatInProgressStatus(context, "sessions");
      await persistProgress("sessions", message);
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "sessions");
    await persistProgress("sessions", message);
  }
  return { summary, sessionIdMap };
};
var importSessionResults = async (tx, datasetRows, sessionIdMap, statusIdMap, userIdMap, importJob, context, persistProgress) => {
  const sessionResultRows = datasetRows.get("session_results") ?? [];
  const summary = {
    entity: "sessionResults",
    total: 0,
    created: 0,
    mapped: 0
  };
  const sessionResultIdMap = /* @__PURE__ */ new Map();
  if (sessionResultRows.length === 0) {
    logMessage(context, "No session results found; skipping.");
    return { summary, sessionResultIdMap };
  }
  const untestedStatus = await tx.status.findFirst({
    where: { systemName: "untested" },
    select: { id: true }
  });
  if (!untestedStatus) {
    throw new Error("Default 'untested' status not found in workspace");
  }
  const defaultStatusId = untestedStatus.id;
  initializeEntityProgress(context, "sessionResults", sessionResultRows.length);
  let processedSinceLastPersist = 0;
  for (const row of sessionResultRows) {
    const record = row;
    const sourceResultId = toNumberValue(record.id);
    const sourceSessionId = toNumberValue(record.session_id);
    const sourceStatusId = toNumberValue(record.status_id);
    if (sourceResultId === null || sourceSessionId === null) {
      decrementEntityTotal(context, "sessionResults");
      continue;
    }
    const sessionId = sessionIdMap.get(sourceSessionId);
    if (!sessionId) {
      logMessage(context, "Skipping session result - session not found", {
        sourceSessionId
      });
      decrementEntityTotal(context, "sessionResults");
      continue;
    }
    let statusId;
    if (sourceStatusId !== null) {
      statusId = statusIdMap.get(sourceStatusId) ?? defaultStatusId;
    } else {
      statusId = defaultStatusId;
    }
    const comment = convertToTipTapJsonString(record.comment);
    const elapsedRaw = toNumberValue(record.elapsed);
    const elapsed = elapsedRaw !== null ? Math.floor(elapsedRaw / 1e6) : null;
    const createdAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
    const createdById = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );
    const sessionResult = await tx.sessionResults.create({
      data: {
        sessionId,
        statusId,
        resultData: comment ?? void 0,
        elapsed,
        createdAt,
        createdById
      }
    });
    sessionResultIdMap.set(sourceResultId, sessionResult.id);
    summary.created += 1;
    incrementEntityProgress(context, "sessionResults", 1, 0);
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
      const message = formatInProgressStatus(context, "sessionResults");
      await persistProgress("sessionResults", message);
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "sessionResults");
    await persistProgress("sessionResults", message);
  }
  return { summary, sessionResultIdMap };
};
var importSessionValues = async (tx, datasetRows, sessionIdMap, testmoFieldValueMap, configuration, caseFieldMap, caseFieldMetadataById, importJob, context, persistProgress) => {
  const sessionValueRows = datasetRows.get("session_values") ?? [];
  const summary = {
    entity: "sessionValues",
    total: 0,
    created: 0,
    mapped: 0
  };
  if (sessionValueRows.length === 0) {
    logMessage(context, "No session values found; skipping.");
    return { summary };
  }
  const multiSelectValuesBySessionAndField = /* @__PURE__ */ new Map();
  for (const row of sessionValueRows) {
    const record = row;
    const sessionId = toNumberValue(record.session_id);
    const fieldId = toNumberValue(record.field_id);
    const valueId = toNumberValue(record.value_id);
    if (sessionId !== null && fieldId !== null && valueId !== null) {
      const key = `${sessionId}:${fieldId}`;
      const values = multiSelectValuesBySessionAndField.get(key) ?? [];
      values.push(valueId);
      multiSelectValuesBySessionAndField.set(key, values);
    }
  }
  const testmoFieldIdBySystemName = /* @__PURE__ */ new Map();
  for (const [key, fieldConfig] of Object.entries(
    configuration.templateFields ?? {}
  )) {
    const testmoFieldId = Number(key);
    if (fieldConfig && fieldConfig.systemName) {
      testmoFieldIdBySystemName.set(fieldConfig.systemName, testmoFieldId);
    }
  }
  const processedCombinations = /* @__PURE__ */ new Set();
  initializeEntityProgress(
    context,
    "sessionValues",
    multiSelectValuesBySessionAndField.size
  );
  let processedSinceLastPersist = 0;
  for (const [key, valueIds] of multiSelectValuesBySessionAndField.entries()) {
    if (processedCombinations.has(key)) {
      continue;
    }
    processedCombinations.add(key);
    const [sessionSourceIdStr, fieldSourceIdStr] = key.split(":");
    const sessionSourceId = Number(sessionSourceIdStr);
    const fieldSourceId = Number(fieldSourceIdStr);
    const sessionId = sessionIdMap.get(sessionSourceId);
    if (!sessionId) {
      decrementEntityTotal(context, "sessionValues");
      continue;
    }
    let testPlanItFieldId;
    let fieldSystemName;
    for (const [
      systemName,
      testmoFieldId
    ] of testmoFieldIdBySystemName.entries()) {
      if (testmoFieldId === fieldSourceId) {
        fieldSystemName = systemName;
        testPlanItFieldId = caseFieldMap.get(systemName);
        break;
      }
    }
    if (!testPlanItFieldId || !fieldSystemName) {
      decrementEntityTotal(context, "sessionValues");
      continue;
    }
    const resolvedValueNames = [];
    for (const valueId of valueIds) {
      const valueMeta = testmoFieldValueMap.get(valueId);
      if (valueMeta) {
        resolvedValueNames.push(valueMeta.name);
      }
    }
    if (resolvedValueNames.length === 0) {
      decrementEntityTotal(context, "sessionValues");
      continue;
    }
    await tx.sessionFieldValues.create({
      data: {
        sessionId,
        fieldId: testPlanItFieldId,
        value: resolvedValueNames
      }
    });
    summary.created += 1;
    incrementEntityProgress(context, "sessionValues", 1, 0);
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
      const message = formatInProgressStatus(context, "sessionValues");
      await persistProgress("sessionValues", message);
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "sessionValues");
    await persistProgress("sessionValues", message);
  }
  return { summary };
};
var importRepositories = async (tx, datasetRows, projectIdMap, context, persistProgress) => {
  const summary = {
    entity: "repositories",
    total: 0,
    created: 0,
    mapped: 0
  };
  const repositoryIdMap = /* @__PURE__ */ new Map();
  const canonicalRepoIdByProject = /* @__PURE__ */ new Map();
  const primaryRepositoryIdByProject = /* @__PURE__ */ new Map();
  const masterRepositoryIds = /* @__PURE__ */ new Set();
  const repositoryRows = datasetRows.get("repositories") ?? [];
  let folderRows = datasetRows.get("repository_folders") ?? [];
  let caseRows = datasetRows.get("repository_cases") ?? [];
  const repositoriesByProject = /* @__PURE__ */ new Map();
  for (const row of repositoryRows) {
    const record = row;
    const repoId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    if (repoId === null || projectSourceId === null) {
      continue;
    }
    const collection = repositoriesByProject.get(projectSourceId) ?? [];
    collection.push(record);
    repositoriesByProject.set(projectSourceId, collection);
  }
  const canonicalRepositoryRows = [];
  if (repositoriesByProject.size > 0) {
    for (const [projectSourceId, rows] of repositoriesByProject) {
      const explicitMasters = rows.filter((record) => {
        const value = toNumberValue(record.is_master);
        return value === 1;
      });
      const nonSnapshotRows = rows.filter((record) => {
        const snapshotFlag = toNumberValue(record.is_snapshot);
        return snapshotFlag !== 1;
      });
      const selectedRows = explicitMasters.length > 0 ? explicitMasters : nonSnapshotRows.length > 0 ? nonSnapshotRows : rows.slice(0, 1);
      const repoSet = /* @__PURE__ */ new Set();
      for (const record of selectedRows) {
        const repoId = toNumberValue(record.id);
        if (repoId === null || repoSet.has(repoId)) {
          continue;
        }
        repoSet.add(repoId);
        masterRepositoryIds.add(repoId);
        canonicalRepositoryRows.push(record);
      }
      if (repoSet.size === 0) {
        continue;
      }
      canonicalRepoIdByProject.set(projectSourceId, repoSet);
    }
    if (canonicalRepositoryRows.length > 0) {
      datasetRows.set("repositories", canonicalRepositoryRows);
    }
  }
  if (masterRepositoryIds.size > 0) {
    const filteredFolders = folderRows.filter((row) => {
      const record = row;
      const repoId = toNumberValue(record.repo_id);
      return repoId !== null ? masterRepositoryIds.has(repoId) : true;
    });
    datasetRows.set("repository_folders", filteredFolders);
    folderRows = filteredFolders;
    const filteredCases = caseRows.filter((row) => {
      const record = row;
      const repoId = toNumberValue(record.repo_id);
      return repoId !== null ? masterRepositoryIds.has(repoId) : true;
    });
    datasetRows.set("repository_cases", filteredCases);
    caseRows = filteredCases;
    const caseValueRows = datasetRows.get("repository_case_values");
    if (Array.isArray(caseValueRows) && caseValueRows.length > 0) {
      const filteredCaseValues = caseValueRows.filter((row) => {
        const record = row;
        const repoId = toNumberValue(record.repo_id);
        return repoId !== null ? masterRepositoryIds.has(repoId) : true;
      });
      datasetRows.set("repository_case_values", filteredCaseValues);
    }
    const caseStepRows = datasetRows.get("repository_case_steps");
    if (Array.isArray(caseStepRows) && caseStepRows.length > 0) {
      const filteredCaseSteps = caseStepRows.filter((row) => {
        const record = row;
        const repoId = toNumberValue(record.repo_id);
        return repoId !== null ? masterRepositoryIds.has(repoId) : true;
      });
      datasetRows.set("repository_case_steps", filteredCaseSteps);
    }
  }
  const baseRepositoryRows = canonicalRepositoryRows.length > 0 ? canonicalRepositoryRows : repositoryRows;
  if (baseRepositoryRows.length === 0 && folderRows.length === 0 && caseRows.length === 0) {
    logMessage(
      context,
      "No repository data available; skipping repository import."
    );
    return {
      summary,
      repositoryIdMap,
      canonicalRepoIdByProject,
      masterRepositoryIds
    };
  }
  const repoProjectLookup = /* @__PURE__ */ new Map();
  const registerRepoCandidate = (repoId, projectId) => {
    if (repoId === null || projectId === null) {
      return;
    }
    if (masterRepositoryIds.size > 0 && !isCanonicalRepository(projectId, repoId, canonicalRepoIdByProject)) {
      return;
    }
    repoProjectLookup.set(repoId, projectId);
  };
  for (const row of baseRepositoryRows) {
    const record = row;
    registerRepoCandidate(
      toNumberValue(record.id),
      toNumberValue(record.project_id)
    );
  }
  const hydrateRepoProject = (rows, repoKey) => {
    for (const row of rows) {
      const record = row;
      registerRepoCandidate(
        toNumberValue(record[repoKey]),
        toNumberValue(record.project_id)
      );
    }
  };
  hydrateRepoProject(folderRows, "repo_id");
  hydrateRepoProject(caseRows, "repo_id");
  if (repoProjectLookup.size === 0) {
    logMessage(
      context,
      "No repository data available; skipping repository import."
    );
    return {
      summary,
      repositoryIdMap,
      canonicalRepoIdByProject,
      masterRepositoryIds
    };
  }
  initializeEntityProgress(context, "repositories", repoProjectLookup.size);
  let processedSinceLastPersist = 0;
  for (const [repoId, projectSourceId] of repoProjectLookup) {
    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(
        context,
        "Skipping repository due to missing project mapping",
        {
          repoId,
          projectSourceId
        }
      );
      decrementEntityTotal(context, "repositories");
      continue;
    }
    summary.total += 1;
    const repoSet = canonicalRepoIdByProject.get(projectSourceId) ?? /* @__PURE__ */ new Set();
    if (!canonicalRepoIdByProject.has(projectSourceId)) {
      canonicalRepoIdByProject.set(projectSourceId, repoSet);
    }
    const existingPrimaryRepositoryId = primaryRepositoryIdByProject.get(projectSourceId);
    if (existingPrimaryRepositoryId !== void 0) {
      repositoryIdMap.set(repoId, existingPrimaryRepositoryId);
      repoSet.add(repoId);
      summary.mapped += 1;
      incrementEntityProgress(context, "repositories", 0, 1);
      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
        const message = formatInProgressStatus(context, "repositories");
        await persistProgress("repositories", message);
        processedSinceLastPersist = 0;
      }
      continue;
    }
    const existingRepository = await tx.repositories.findFirst({
      where: { projectId, isDeleted: false },
      orderBy: { id: "asc" }
    });
    let repositoryId;
    if (existingRepository && repositoryRows.length === 0) {
      repositoryId = existingRepository.id;
      summary.mapped += 1;
      incrementEntityProgress(context, "repositories", 0, 1);
    } else {
      const repository = await tx.repositories.create({
        data: {
          projectId
        }
      });
      repositoryId = repository.id;
      summary.created += 1;
      incrementEntityProgress(context, "repositories", 1, 0);
    }
    repositoryIdMap.set(repoId, repositoryId);
    repoSet.add(repoId);
    primaryRepositoryIdByProject.set(projectSourceId, repositoryId);
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
      const message = formatInProgressStatus(context, "repositories");
      await persistProgress("repositories", message);
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "repositories");
    await persistProgress("repositories", message);
  }
  repoProjectLookup.clear();
  return {
    summary,
    repositoryIdMap,
    canonicalRepoIdByProject,
    masterRepositoryIds
  };
};
var importRepositoryFolders = async (datasetRows, projectIdMap, repositoryIdMap, canonicalRepoIdByProject, importJob, userIdMap, context, persistProgress) => {
  const folderRows = datasetRows.get("repository_folders") ?? [];
  const summary = {
    entity: "repositoryFolders",
    total: 0,
    created: 0,
    mapped: 0
  };
  const folderIdMap = /* @__PURE__ */ new Map();
  const repositoryRootFolderMap = /* @__PURE__ */ new Map();
  if (folderRows.length === 0) {
    logMessage(
      context,
      "No repository folders dataset found; skipping folder import."
    );
    return { summary, folderIdMap, repositoryRootFolderMap };
  }
  const canonicalFolderRecords = /* @__PURE__ */ new Map();
  for (const row of folderRows) {
    const record = row;
    const folderId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);
    if (!isCanonicalRepository(
      projectSourceId,
      repoSourceId,
      canonicalRepoIdByProject
    )) {
      continue;
    }
    if (folderId !== null) {
      canonicalFolderRecords.set(folderId, record);
    }
  }
  if (canonicalFolderRecords.size === 0) {
    logMessage(
      context,
      "No canonical repository folders found; skipping folder import."
    );
    return { summary, folderIdMap, repositoryRootFolderMap };
  }
  initializeEntityProgress(
    context,
    "repositoryFolders",
    canonicalFolderRecords.size
  );
  let processedSinceLastPersist = 0;
  const processedFolders = /* @__PURE__ */ new Set();
  const processingFolders = /* @__PURE__ */ new Set();
  const fallbackCreator = importJob.createdById;
  const folderSignatureMap = /* @__PURE__ */ new Map();
  const ensureRepositoryFor = async (repoSourceId, projectId) => {
    let repositoryId = repositoryIdMap.get(repoSourceId);
    if (!repositoryId) {
      const repository = await prisma.repositories.create({
        data: { projectId }
      });
      repositoryId = repository.id;
      repositoryIdMap.set(repoSourceId, repositoryId);
    }
    return repositoryId;
  };
  const importFolder = async (folderSourceId) => {
    if (folderIdMap.has(folderSourceId)) {
      return folderIdMap.get(folderSourceId) ?? null;
    }
    const record = canonicalFolderRecords.get(folderSourceId);
    if (!record) {
      return null;
    }
    if (processingFolders.has(folderSourceId)) {
      logMessage(
        context,
        "Detected folder parent cycle; attaching to repository root",
        {
          folderSourceId
        }
      );
      return null;
    }
    processingFolders.add(folderSourceId);
    try {
      if (!processedFolders.has(folderSourceId)) {
        summary.total += 1;
        processedFolders.add(folderSourceId);
      }
      const projectSourceId = toNumberValue(record.project_id);
      const repoSourceId = toNumberValue(record.repo_id);
      const parentSourceId = toNumberValue(record.parent_id);
      if (projectSourceId === null || repoSourceId === null) {
        decrementEntityTotal(context, "repositoryFolders");
        return null;
      }
      const projectId = projectIdMap.get(projectSourceId);
      if (!projectId) {
        logMessage(context, "Skipping folder due to missing project mapping", {
          folderSourceId,
          projectSourceId
        });
        decrementEntityTotal(context, "repositoryFolders");
        return null;
      }
      const targetRepoId = getPreferredRepositoryId(
        projectSourceId,
        repoSourceId,
        canonicalRepoIdByProject
      );
      if (targetRepoId === null) {
        logMessage(
          context,
          "Skipping folder due to missing canonical repository",
          {
            folderSourceId,
            projectSourceId,
            repoSourceId
          }
        );
        decrementEntityTotal(context, "repositoryFolders");
        return null;
      }
      const repositoryId = await ensureRepositoryFor(targetRepoId, projectId);
      if (!repositoryIdMap.has(targetRepoId)) {
        repositoryIdMap.set(targetRepoId, repositoryId);
      }
      if (repoSourceId !== null) {
        repositoryIdMap.set(repoSourceId, repositoryId);
      }
      let parentId = null;
      if (parentSourceId !== null) {
        const mappedParent = folderIdMap.get(parentSourceId);
        if (mappedParent !== void 0) {
          parentId = mappedParent ?? null;
        } else {
          const createdParent = await importFolder(parentSourceId);
          parentId = createdParent ?? null;
        }
      }
      if (parentSourceId !== null && parentId === null) {
        logMessage(
          context,
          "Folder parent missing; attaching to repository root",
          {
            folderSourceId,
            parentSourceId
          }
        );
        parentId = repositoryRootFolderMap.get(repositoryId) ?? null;
      }
      const name = toStringValue2(record.name) ?? `Folder ${folderSourceId}`;
      const signature = `${repositoryId}:${parentId}:${name}`;
      const existingFolderId = folderSignatureMap.get(signature);
      if (existingFolderId !== void 0) {
        folderIdMap.set(folderSourceId, existingFolderId);
        summary.mapped += 1;
        incrementEntityProgress(context, "repositoryFolders", 0, 1);
        return existingFolderId;
      }
      const docsValue = convertToTipTapJsonString(record.docs);
      const order = toNumberValue(record.display_order) ?? 0;
      const creatorId = resolveUserId(
        userIdMap,
        fallbackCreator,
        record.created_by
      );
      const createdAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
      const transactionResult = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.repositoryFolders.findFirst({
            where: {
              projectId,
              repositoryId,
              parentId,
              name,
              isDeleted: false
            }
          });
          if (existing) {
            return { folderId: existing.id, created: false };
          }
          const folder = await tx.repositoryFolders.create({
            data: {
              projectId,
              repositoryId,
              parentId,
              name,
              order,
              creatorId,
              createdAt,
              ...docsValue !== null ? { docs: docsValue } : {}
            }
          });
          return { folderId: folder.id, created: true };
        },
        {
          timeout: REPOSITORY_FOLDER_TRANSACTION_TIMEOUT_MS,
          maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS
        }
      );
      const folderId = transactionResult.folderId;
      if (transactionResult.created) {
        summary.created += 1;
        incrementEntityProgress(context, "repositoryFolders", 1, 0);
      } else {
        summary.mapped += 1;
        incrementEntityProgress(context, "repositoryFolders", 0, 1);
      }
      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
        const message = formatInProgressStatus(context, "repositoryFolders");
        await persistProgress("repositoryFolders", message);
        processedSinceLastPersist = 0;
      }
      folderIdMap.set(folderSourceId, folderId);
      folderSignatureMap.set(signature, folderId);
      if (parentId === null && !repositoryRootFolderMap.has(repositoryId)) {
        repositoryRootFolderMap.set(repositoryId, folderId);
      }
      return folderId;
    } finally {
      processingFolders.delete(folderSourceId);
    }
  };
  for (const folderSourceId of canonicalFolderRecords.keys()) {
    await importFolder(folderSourceId);
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "repositoryFolders");
    await persistProgress("repositoryFolders", message);
  }
  canonicalFolderRecords.clear();
  processedFolders.clear();
  processingFolders.clear();
  return { summary, folderIdMap, repositoryRootFolderMap };
};
var importRepositoryCases = async (datasetRows, projectIdMap, repositoryIdMap, canonicalRepoIdByProject, folderIdMap, repositoryRootFolderMap, templateIdMap, templateNameMap, workflowIdMap, userIdMap, caseFieldMap, testmoFieldValueMap, configuration, importJob, context, persistProgress) => {
  const caseRows = datasetRows.get("repository_cases") ?? [];
  const caseValuesRows = datasetRows.get("repository_case_values") ?? [];
  const multiSelectValuesByCaseAndField = /* @__PURE__ */ new Map();
  for (const row of caseValuesRows) {
    const record = row;
    const caseId = toNumberValue(record.case_id);
    const fieldId = toNumberValue(record.field_id);
    const valueId = toNumberValue(record.value_id);
    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);
    if (!isCanonicalRepository(
      projectSourceId,
      repoSourceId,
      canonicalRepoIdByProject
    )) {
      continue;
    }
    if (caseId !== null && fieldId !== null && valueId !== null) {
      const key = `${caseId}:${fieldId}`;
      const values = multiSelectValuesByCaseAndField.get(key) ?? [];
      values.push(valueId);
      multiSelectValuesByCaseAndField.set(key, values);
    }
  }
  const summary = {
    entity: "repositoryCases",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      estimateAdjusted: 0,
      estimateClamped: 0
    }
  };
  const caseIdMap = /* @__PURE__ */ new Map();
  const caseMetaMap = /* @__PURE__ */ new Map();
  const summaryDetails = summary.details;
  const dropdownStats = /* @__PURE__ */ new Map();
  const templateRows = datasetRows.get("templates") ?? [];
  const templateNameBySourceId = /* @__PURE__ */ new Map();
  for (const row of templateRows) {
    const record = row;
    const sourceId = toNumberValue(record.id);
    const name = toStringValue2(record.name);
    if (sourceId !== null && name) {
      templateNameBySourceId.set(sourceId, name);
    }
  }
  const canonicalCaseRows = [];
  const canonicalCaseIds = /* @__PURE__ */ new Set();
  for (let index = 0; index < caseRows.length; index += 1) {
    const record = caseRows[index];
    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);
    const caseSourceId = toNumberValue(record.id);
    if (!isCanonicalRepository(
      projectSourceId,
      repoSourceId,
      canonicalRepoIdByProject
    )) {
      continue;
    }
    if (caseSourceId !== null) {
      canonicalCaseRows.push(record);
      canonicalCaseIds.add(caseSourceId);
    }
  }
  caseRows.length = 0;
  const repositoryCaseStepRows = datasetRows.get("repository_case_steps") ?? [];
  datasetRows.delete("repository_case_steps");
  const stepsByCaseId = /* @__PURE__ */ new Map();
  for (const row of repositoryCaseStepRows) {
    const record = row;
    const caseId = toNumberValue(record.case_id);
    if (caseId === null || !canonicalCaseIds.has(caseId)) {
      continue;
    }
    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);
    if (!isCanonicalRepository(
      projectSourceId,
      repoSourceId,
      canonicalRepoIdByProject
    )) {
      continue;
    }
    const collection = stepsByCaseId.get(caseId);
    if (collection) {
      collection.push(record);
    } else {
      stepsByCaseId.set(caseId, [record]);
    }
  }
  const resolvedTemplateIdsByName = new Map(templateNameMap);
  const templateAssignmentsByProject = /* @__PURE__ */ new Map();
  const canonicalCaseCount = canonicalCaseRows.length;
  if (canonicalCaseCount === 0) {
    logMessage(
      context,
      "No repository cases dataset found; skipping case import."
    );
    return {
      summary,
      caseIdMap,
      caseFieldMap: /* @__PURE__ */ new Map(),
      caseFieldMetadataById: /* @__PURE__ */ new Map(),
      caseMetaMap
    };
  }
  initializeEntityProgress(context, "repositoryCases", canonicalCaseCount);
  let processedSinceLastPersist = 0;
  const defaultTemplate = await prisma.templates.findFirst({
    where: { isDefault: true },
    select: { id: true }
  });
  const defaultCaseWorkflow = await prisma.workflows.findFirst({
    where: { scope: import_client5.WorkflowScope.CASES, isDefault: true },
    select: { id: true }
  });
  const fallbackCreator = importJob.createdById;
  const caseFieldMetadataById = /* @__PURE__ */ new Map();
  if (caseFieldMap.size > 0) {
    const uniqueCaseFieldIds = Array.from(
      new Set(Array.from(caseFieldMap.values()))
    );
    const caseFieldRecords = await prisma.caseFields.findMany({
      where: {
        id: {
          in: uniqueCaseFieldIds
        }
      },
      include: {
        type: {
          select: {
            type: true
          }
        },
        fieldOptions: {
          include: {
            fieldOption: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });
    for (const field of caseFieldRecords) {
      const optionsByName = /* @__PURE__ */ new Map();
      const optionIds = /* @__PURE__ */ new Set();
      for (const assignment of field.fieldOptions ?? []) {
        const option = assignment.fieldOption;
        if (!option) {
          continue;
        }
        optionIds.add(option.id);
        optionsByName.set(option.name.trim().toLowerCase(), option.id);
      }
      caseFieldMetadataById.set(field.id, {
        id: field.id,
        systemName: field.systemName,
        displayName: field.displayName,
        type: field.type.type,
        optionIds,
        optionsByName
      });
    }
  }
  const recordFieldWarning = (message, details) => {
    logMessage(context, message, details);
  };
  const chunkSize = Math.max(1, REPOSITORY_CASE_CHUNK_SIZE);
  logMessage(context, `Processing repository cases in batches of ${chunkSize}`);
  const processChunk = async (records) => {
    if (records.length === 0) {
      return;
    }
    await prisma.$transaction(
      async (tx) => {
        for (const record of records) {
          const caseSourceId = toNumberValue(record.id);
          const projectSourceId = toNumberValue(record.project_id);
          const repoSourceId = toNumberValue(record.repo_id);
          const folderSourceId = toNumberValue(record.folder_id);
          const caseName = toStringValue2(record.name) ?? `Imported Case ${caseSourceId ?? 0}`;
          if (caseSourceId === null || projectSourceId === null || repoSourceId === null) {
            decrementEntityTotal(context, "repositoryCases");
            continue;
          }
          const projectId = projectIdMap.get(projectSourceId);
          if (!projectId) {
            logMessage(
              context,
              "Skipping case due to missing project mapping",
              {
                caseSourceId,
                projectSourceId
              }
            );
            decrementEntityTotal(context, "repositoryCases");
            if (caseSourceId !== null) {
              canonicalCaseIds.delete(caseSourceId);
              stepsByCaseId.delete(caseSourceId);
            }
            continue;
          }
          const targetRepoId = getPreferredRepositoryId(
            projectSourceId,
            repoSourceId,
            canonicalRepoIdByProject
          );
          if (caseSourceId !== null) {
            caseMetaMap.set(caseSourceId, { projectId, name: caseName });
          }
          if (targetRepoId === null) {
            const existingFallback = await tx.repositoryCases.findFirst({
              where: {
                projectId,
                name: caseName,
                isDeleted: false
              },
              select: { id: true }
            });
            if (existingFallback) {
              caseIdMap.set(caseSourceId, existingFallback.id);
              summary.total += 1;
              summary.mapped += 1;
            }
            logMessage(
              context,
              "Skipping case due to missing canonical repository",
              {
                caseSourceId,
                projectSourceId,
                repoSourceId
              }
            );
            decrementEntityTotal(context, "repositoryCases");
            canonicalCaseIds.delete(caseSourceId);
            stepsByCaseId.delete(caseSourceId);
            continue;
          }
          let repositoryId = repositoryIdMap.get(targetRepoId);
          if (repositoryId === void 0) {
            const repository = await tx.repositories.create({
              data: { projectId }
            });
            repositoryId = repository.id;
            repositoryIdMap.set(targetRepoId, repositoryId);
          }
          const resolvedRepositoryId = repositoryId;
          if (repoSourceId !== null) {
            repositoryIdMap.set(repoSourceId, resolvedRepositoryId);
          }
          let folderId = folderSourceId !== null ? folderIdMap.get(folderSourceId) ?? null : null;
          if (folderId == null) {
            const rootFolderId = repositoryRootFolderMap.get(resolvedRepositoryId);
            if (rootFolderId) {
              folderId = rootFolderId;
            } else {
              const fallbackFolder = await tx.repositoryFolders.create({
                data: {
                  projectId,
                  repositoryId: resolvedRepositoryId,
                  name: "Imported",
                  creatorId: fallbackCreator
                }
              });
              folderId = fallbackFolder.id;
              repositoryRootFolderMap.set(
                resolvedRepositoryId,
                fallbackFolder.id
              );
            }
          }
          if (folderId == null) {
            logMessage(context, "Skipping case due to missing folder mapping", {
              caseSourceId,
              folderSourceId
            });
            decrementEntityTotal(context, "repositoryCases");
            canonicalCaseIds.delete(caseSourceId);
            stepsByCaseId.delete(caseSourceId);
            continue;
          }
          const resolvedFolderId = folderId;
          const existing = await tx.repositoryCases.findFirst({
            where: {
              projectId,
              name: caseName,
              isDeleted: false
            }
          });
          if (existing) {
            caseIdMap.set(caseSourceId, existing.id);
            summary.total += 1;
            summary.mapped += 1;
            incrementEntityProgress(context, "repositoryCases", 0, 1);
            processedSinceLastPersist += 1;
            if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
              const message = formatInProgressStatus(
                context,
                "repositoryCases"
              );
              await persistProgress("repositoryCases", message);
              processedSinceLastPersist = 0;
            }
            canonicalCaseIds.delete(caseSourceId);
            stepsByCaseId.delete(caseSourceId);
            continue;
          }
          const templateSourceId = toNumberValue(record.template_id);
          const stateSourceId = toNumberValue(record.state_id);
          let templateId = null;
          if (templateSourceId !== null) {
            const mappedTemplateId = templateIdMap.get(templateSourceId);
            if (mappedTemplateId !== void 0) {
              templateId = mappedTemplateId;
            } else {
              const templateName2 = templateNameBySourceId.get(templateSourceId);
              if (templateName2) {
                templateId = resolvedTemplateIdsByName.get(templateName2) ?? null;
                if (!templateId) {
                  const existingTemplate = await tx.templates.findFirst({
                    where: { templateName: templateName2, isDeleted: false }
                  });
                  if (existingTemplate) {
                    templateId = existingTemplate.id;
                  } else {
                    const createdTemplate = await tx.templates.create({
                      data: {
                        templateName: templateName2,
                        isEnabled: true,
                        isDefault: false
                      }
                    });
                    templateId = createdTemplate.id;
                  }
                  resolvedTemplateIdsByName.set(templateName2, templateId);
                  templateNameMap.set(templateName2, templateId);
                }
                if (templateId !== null) {
                  templateIdMap.set(templateSourceId, templateId);
                }
              }
            }
          }
          templateId = templateId ?? defaultTemplate?.id ?? null;
          const workflowId = (stateSourceId !== null ? workflowIdMap.get(stateSourceId) : null) ?? defaultCaseWorkflow?.id ?? null;
          if (templateId == null || workflowId == null) {
            logMessage(
              context,
              "Skipping case due to missing template or workflow mapping",
              {
                caseSourceId,
                templateSourceId,
                stateSourceId
              }
            );
            decrementEntityTotal(context, "repositoryCases");
            canonicalCaseIds.delete(caseSourceId);
            stepsByCaseId.delete(caseSourceId);
            continue;
          }
          const resolvedTemplateId = templateId;
          const resolvedWorkflowId = workflowId;
          const creatorId = resolveUserId(
            userIdMap,
            fallbackCreator,
            record.created_by
          );
          const createdAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
          const order = toNumberValue(record.display_order) ?? 0;
          const className = toStringValue2(record.key);
          const estimateValue = toNumberValue(record.estimate);
          const { value: normalizedEstimate, adjustment: estimateAdjustment } = normalizeEstimate(estimateValue);
          if (estimateAdjustment === "nanoseconds" || estimateAdjustment === "microseconds" || estimateAdjustment === "milliseconds") {
            summaryDetails.estimateAdjusted += 1;
          } else if (estimateAdjustment === "clamped") {
            summaryDetails.estimateClamped += 1;
          }
          const repositoryCase = await tx.repositoryCases.create({
            data: {
              projectId,
              repositoryId: resolvedRepositoryId,
              folderId: resolvedFolderId,
              templateId: resolvedTemplateId,
              name: caseName,
              className: className ?? void 0,
              stateId: resolvedWorkflowId,
              estimate: normalizedEstimate ?? void 0,
              order,
              createdAt,
              creatorId,
              automated: toBooleanValue(record.automated ?? false),
              currentVersion: 1
            }
          });
          caseIdMap.set(caseSourceId, repositoryCase.id);
          const projectTemplateAssignments = templateAssignmentsByProject.get(projectId) ?? /* @__PURE__ */ new Set();
          projectTemplateAssignments.add(resolvedTemplateId);
          templateAssignmentsByProject.set(
            projectId,
            projectTemplateAssignments
          );
          summary.total += 1;
          summary.created += 1;
          incrementEntityProgress(context, "repositoryCases", 1, 0);
          processedSinceLastPersist += 1;
          if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
            const message = formatInProgressStatus(context, "repositoryCases");
            await persistProgress("repositoryCases", message);
            processedSinceLastPersist = 0;
          }
          for (const [key, rawValue] of Object.entries(record)) {
            if (!key.startsWith("custom_")) {
              continue;
            }
            const fieldName = key.replace(/^custom_/, "");
            const fieldId = caseFieldMap.get(fieldName);
            if (!fieldId) {
              continue;
            }
            const fieldMetadata = caseFieldMetadataById.get(fieldId);
            if (!fieldMetadata) {
              recordFieldWarning("Missing case field metadata", {
                field: fieldName,
                fieldId,
                caseSourceId
              });
              continue;
            }
            if (rawValue === null || rawValue === void 0 || typeof rawValue === "string" && rawValue.trim().length === 0) {
              continue;
            }
            const processedValue = normalizeCaseFieldValue(
              rawValue,
              fieldMetadata,
              (message, details) => recordFieldWarning(message, {
                caseSourceId,
                field: fieldMetadata.systemName,
                displayName: fieldMetadata.displayName,
                ...details
              }),
              testmoFieldValueMap
            );
            if (fieldMetadata.type.toLowerCase().includes("multi-select")) {
              console.log(`  Processed value:`, processedValue);
              console.log(`  Processed value type: ${typeof processedValue}`);
              console.log(`  Is Array: ${Array.isArray(processedValue)}`);
              console.log(
                `  Will save to DB:`,
                processedValue !== null && processedValue !== void 0
              );
              const stats = dropdownStats.get(fieldMetadata.systemName) || {
                totalAttempts: 0,
                nullResults: 0,
                successResults: 0,
                sampleValues: /* @__PURE__ */ new Set(),
                sampleNulls: []
              };
              stats.totalAttempts++;
              if (processedValue === null || processedValue === void 0) {
                stats.nullResults++;
                if (stats.sampleNulls.length < 3) {
                  stats.sampleNulls.push(rawValue);
                }
              } else {
                stats.successResults++;
                if (stats.sampleValues.size < 3) {
                  stats.sampleValues.add(JSON.stringify(processedValue));
                }
              }
              dropdownStats.set(fieldMetadata.systemName, stats);
            }
            if (processedValue === void 0 || processedValue === null) {
              continue;
            }
            if (isTipTapDocument(processedValue) && isTipTapDocumentEmpty(processedValue)) {
              continue;
            }
            if (typeof processedValue === "string" && !processedValue.trim()) {
              continue;
            }
            if (Array.isArray(processedValue) && processedValue.length === 0) {
              continue;
            }
            await tx.caseFieldValues.create({
              data: {
                testCaseId: repositoryCase.id,
                fieldId,
                value: toInputJsonValue(processedValue)
              }
            });
          }
          const testmoFieldIdBySystemName = /* @__PURE__ */ new Map();
          for (const [key, fieldConfig] of Object.entries(
            configuration.templateFields ?? {}
          )) {
            const testmoFieldId = Number(key);
            if (fieldConfig && fieldConfig.systemName) {
              testmoFieldIdBySystemName.set(
                fieldConfig.systemName,
                testmoFieldId
              );
            }
          }
          for (const [systemName, fieldId] of caseFieldMap.entries()) {
            const fieldMetadata = caseFieldMetadataById.get(fieldId);
            if (!fieldMetadata || !fieldMetadata.type.toLowerCase().includes("multi-select")) {
              continue;
            }
            const testmoFieldId = testmoFieldIdBySystemName.get(systemName);
            if (!testmoFieldId) {
              continue;
            }
            const lookupKey = `${caseSourceId}:${testmoFieldId}`;
            const valueIds = multiSelectValuesByCaseAndField.get(lookupKey);
            if (!valueIds || valueIds.length === 0) {
              continue;
            }
            const processedValue = normalizeCaseFieldValue(
              valueIds,
              fieldMetadata,
              (message, details) => recordFieldWarning(message, {
                caseSourceId,
                field: fieldMetadata.systemName,
                displayName: fieldMetadata.displayName,
                source: "repository_case_values",
                ...details
              }),
              testmoFieldValueMap
            );
            if (processedValue === void 0 || processedValue === null) {
              continue;
            }
            if (Array.isArray(processedValue) && processedValue.length === 0) {
              continue;
            }
            const existingValue = await tx.caseFieldValues.findFirst({
              where: {
                testCaseId: repositoryCase.id,
                fieldId
              }
            });
            if (existingValue) {
              await tx.caseFieldValues.update({
                where: {
                  id: existingValue.id
                },
                data: {
                  value: toInputJsonValue(processedValue)
                }
              });
            } else {
              await tx.caseFieldValues.create({
                data: {
                  testCaseId: repositoryCase.id,
                  fieldId,
                  value: toInputJsonValue(processedValue)
                }
              });
            }
          }
          const caseSteps = stepsByCaseId.get(caseSourceId) ?? [];
          const stepsForVersion = [];
          if (caseSteps.length > 0) {
            let generatedOrder = 0;
            const stepEntries = [];
            for (const stepRecord of caseSteps) {
              const stepAction = toStringValue2(stepRecord.text1);
              const stepData = toStringValue2(stepRecord.text2);
              const expectedResult = toStringValue2(stepRecord.text3);
              const expectedResultData = toStringValue2(stepRecord.text4);
              if (!stepAction && !stepData && !expectedResult && !expectedResultData) {
                continue;
              }
              let orderValue = toNumberValue(stepRecord.display_order);
              if (orderValue === null) {
                generatedOrder += 1;
                orderValue = generatedOrder;
              } else {
                generatedOrder = orderValue;
              }
              const stepEntry = {
                testCaseId: repositoryCase.id,
                order: orderValue
              };
              if (stepAction || stepData) {
                let combinedStepText = stepAction || "";
                if (stepData) {
                  combinedStepText += (combinedStepText ? "\n" : "") + `<data>${stepData}</data>`;
                }
                const stepPayload = convertToTipTapJsonValue(combinedStepText);
                if (stepPayload !== void 0 && stepPayload !== null) {
                  stepEntry.step = JSON.stringify(stepPayload);
                }
              }
              if (expectedResult || expectedResultData) {
                let combinedExpectedText = expectedResult || "";
                if (expectedResultData) {
                  combinedExpectedText += (combinedExpectedText ? "\n" : "") + `<data>${expectedResultData}</data>`;
                }
                const expectedPayload = convertToTipTapJsonValue(combinedExpectedText);
                if (expectedPayload !== void 0 && expectedPayload !== null) {
                  stepEntry.expectedResult = JSON.stringify(expectedPayload);
                }
              }
              const parseJson = (value) => {
                if (!value) {
                  return emptyEditorContent;
                }
                try {
                  return JSON.parse(value);
                } catch (error) {
                  console.warn("Failed to parse repository case step", {
                    caseSourceId,
                    error
                  });
                  return emptyEditorContent;
                }
              };
              stepsForVersion.push({
                step: parseJson(stepEntry.step),
                expectedResult: parseJson(
                  stepEntry.expectedResult
                )
              });
              stepEntries.push(stepEntry);
            }
            if (stepEntries.length > 0) {
              await tx.steps.createMany({ data: stepEntries });
            }
          }
          const projectName = await getProjectName2(tx, projectId);
          const templateName = await getTemplateName2(tx, resolvedTemplateId);
          const workflowName = await getWorkflowName2(tx, resolvedWorkflowId);
          const folderName = await getFolderName2(tx, resolvedFolderId);
          const creatorName = await getUserName2(tx, creatorId);
          const versionCaseName = toStringValue2(record.name) ?? repositoryCase.name;
          const caseVersion = await tx.repositoryCaseVersions.create({
            data: {
              repositoryCase: { connect: { id: repositoryCase.id } },
              project: { connect: { id: projectId } },
              staticProjectId: projectId,
              staticProjectName: projectName,
              repositoryId: resolvedRepositoryId,
              folderId: resolvedFolderId,
              folderName,
              templateId: resolvedTemplateId,
              templateName,
              name: versionCaseName,
              stateId: resolvedWorkflowId,
              stateName: workflowName,
              estimate: repositoryCase.estimate ?? null,
              forecastManual: repositoryCase.forecastManual ?? null,
              forecastAutomated: repositoryCase.forecastAutomated ?? null,
              order,
              createdAt: repositoryCase.createdAt ?? /* @__PURE__ */ new Date(),
              creatorId,
              creatorName,
              automated: repositoryCase.automated,
              isArchived: repositoryCase.isArchived,
              isDeleted: repositoryCase.isDeleted,
              version: repositoryCase.currentVersion,
              steps: stepsForVersion.length > 0 ? stepsForVersion : import_client5.Prisma.JsonNull,
              tags: [],
              issues: [],
              links: [],
              attachments: []
            }
          });
          const caseFieldValuesForVersion = await tx.caseFieldValues.findMany({
            where: { testCaseId: repositoryCase.id },
            include: {
              field: {
                select: {
                  displayName: true,
                  systemName: true
                }
              }
            }
          });
          if (caseFieldValuesForVersion.length > 0) {
            await tx.caseFieldVersionValues.createMany({
              data: caseFieldValuesForVersion.map((fieldValue) => ({
                versionId: caseVersion.id,
                field: fieldValue.field.displayName || fieldValue.field.systemName,
                value: fieldValue.value ?? import_client5.Prisma.JsonNull
              }))
            });
          }
          canonicalCaseIds.delete(caseSourceId);
          stepsByCaseId.delete(caseSourceId);
        }
      },
      {
        timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS
      }
    );
    clearTipTapCache();
  };
  const totalChunks = Math.ceil(canonicalCaseRows.length / chunkSize);
  let currentChunk = 0;
  while (canonicalCaseRows.length > 0) {
    const chunkRecords = canonicalCaseRows.splice(
      Math.max(canonicalCaseRows.length - chunkSize, 0)
    );
    currentChunk++;
    logMessage(
      context,
      `Processing repository cases chunk ${currentChunk}/${totalChunks}`,
      {
        chunkSize: chunkRecords.length,
        remainingCases: canonicalCaseRows.length,
        processedCount: context.processedCount
      }
    );
    await processChunk(chunkRecords);
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "repositoryCases");
    await persistProgress("repositoryCases", message);
  }
  if (dropdownStats.size > 0) {
    console.log("\n========== DROPDOWN/MULTI-SELECT FIELD SUMMARY ==========");
    for (const [fieldName, stats] of dropdownStats) {
      console.log(`
Field: ${fieldName}`);
      console.log(`  Total attempts: ${stats.totalAttempts}`);
      console.log(`  Successful: ${stats.successResults}`);
      console.log(`  Failed (null): ${stats.nullResults}`);
      if (stats.sampleValues.size > 0) {
        console.log(
          `  Sample success values: ${Array.from(stats.sampleValues).join(", ")}`
        );
      }
      if (stats.sampleNulls.length > 0) {
        console.log(
          `  Sample failed raw values: ${stats.sampleNulls.join(", ")}`
        );
      }
    }
    console.log("==========================================================\n");
  }
  logMessage(context, `Repository cases import completed`, {
    totalProcessed: summary.total,
    created: summary.created,
    mapped: summary.mapped,
    finalProcessedCount: context.processedCount,
    dropdownFieldSummary: Array.from(dropdownStats.entries()).map(
      ([field, stats]) => ({
        field,
        attempts: stats.totalAttempts,
        success: stats.successResults,
        failed: stats.nullResults
      })
    )
  });
  if (templateAssignmentsByProject.size > 0) {
    const assignmentRows = [];
    for (const [projectId, templateIds] of templateAssignmentsByProject) {
      for (const templateId of templateIds) {
        assignmentRows.push({ projectId, templateId });
      }
    }
    if (assignmentRows.length > 0) {
      await prisma.templateProjectAssignment.createMany({
        data: assignmentRows,
        skipDuplicates: true
      });
    }
  }
  if ((summaryDetails.estimateAdjusted ?? 0) > 0) {
    logMessage(
      context,
      "Converted repository case estimates from smaller units",
      {
        adjustments: summaryDetails.estimateAdjusted
      }
    );
  }
  if ((summaryDetails.estimateClamped ?? 0) > 0) {
    logMessage(
      context,
      "Clamped oversized repository case estimates to int32 range",
      {
        clamped: summaryDetails.estimateClamped
      }
    );
  }
  caseRows.length = 0;
  repositoryCaseStepRows.length = 0;
  canonicalCaseRows.length = 0;
  canonicalCaseIds.clear();
  stepsByCaseId.clear();
  clearTipTapCache();
  return {
    summary,
    caseIdMap,
    caseFieldMap,
    caseFieldMetadataById,
    caseMetaMap
  };
};
var importTestRuns = async (tx, datasetRows, projectIdMap, _canonicalRepoIdByProject, configurationIdMap, milestoneIdMap, workflowIdMap, userIdMap, importJob, context, persistProgress) => {
  const runRows = datasetRows.get("runs") ?? [];
  const summary = {
    entity: "testRuns",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      forecastAdjusted: 0,
      forecastClamped: 0,
      elapsedAdjusted: 0,
      elapsedClamped: 0
    }
  };
  const summaryDetails = summary.details;
  const testRunIdMap = /* @__PURE__ */ new Map();
  if (runRows.length === 0) {
    logMessage(context, "No runs dataset found; skipping test run import.");
    return { summary, testRunIdMap };
  }
  initializeEntityProgress(context, "testRuns", runRows.length);
  let processedSinceLastPersist = 0;
  for (const row of runRows) {
    const record = row;
    const sourceId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    if (sourceId === null || projectSourceId === null) {
      decrementEntityTotal(context, "testRuns");
      continue;
    }
    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(context, "Skipping test run due to missing project mapping", {
        sourceId,
        projectSourceId
      });
      decrementEntityTotal(context, "testRuns");
      continue;
    }
    const workflowSourceId = toNumberValue(record.state_id);
    const stateId = workflowSourceId !== null ? workflowIdMap.get(workflowSourceId) ?? null : null;
    if (!stateId) {
      logMessage(context, "Skipping test run due to missing workflow mapping", {
        sourceId,
        workflowSourceId
      });
      decrementEntityTotal(context, "testRuns");
      continue;
    }
    const configurationSourceId = toNumberValue(record.config_id);
    const configurationId = configurationSourceId !== null ? configurationIdMap.get(configurationSourceId) ?? null : null;
    const milestoneSourceId = toNumberValue(record.milestone_id);
    const milestoneId = milestoneSourceId !== null ? milestoneIdMap.get(milestoneSourceId) ?? null : null;
    const name = toStringValue2(record.name) ?? `Imported Run ${sourceId}`;
    const note = convertToTipTapJsonString(record.note);
    const docs = convertToTipTapJsonString(record.docs);
    const createdAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
    const completedAt = toDateValue(record.closed_at);
    const isCompleted = toBooleanValue(record.is_closed);
    const createdById = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );
    const forecastValue = toNumberValue(record.forecast);
    const elapsedValue = toNumberValue(record.elapsed);
    const { value: normalizedForecast, adjustment: forecastAdjustment } = normalizeEstimate(forecastValue);
    const { value: normalizedElapsed, adjustment: elapsedAdjustment } = normalizeEstimate(elapsedValue);
    if (forecastAdjustment === "microseconds" || forecastAdjustment === "nanoseconds") {
      summaryDetails.forecastAdjusted += 1;
    } else if (forecastAdjustment === "milliseconds") {
      summaryDetails.forecastAdjusted += 1;
    } else if (forecastAdjustment === "clamped") {
      summaryDetails.forecastClamped += 1;
    }
    if (elapsedAdjustment === "microseconds" || elapsedAdjustment === "nanoseconds") {
      summaryDetails.elapsedAdjusted += 1;
    } else if (elapsedAdjustment === "milliseconds") {
      summaryDetails.elapsedAdjusted += 1;
    } else if (elapsedAdjustment === "clamped") {
      summaryDetails.elapsedClamped += 1;
    }
    const createdRun = await tx.testRuns.create({
      data: {
        projectId,
        name,
        note: note ?? void 0,
        docs: docs ?? void 0,
        configId: configurationId ?? void 0,
        milestoneId: milestoneId ?? void 0,
        stateId,
        forecastManual: normalizedForecast ?? void 0,
        elapsed: normalizedElapsed ?? void 0,
        isCompleted,
        createdAt,
        createdById,
        completedAt: completedAt ?? void 0
      }
    });
    testRunIdMap.set(sourceId, createdRun.id);
    summary.total += 1;
    summary.created += 1;
    incrementEntityProgress(context, "testRuns", 1, 0);
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
      const message = formatInProgressStatus(context, "testRuns");
      await persistProgress("testRuns", message);
      processedSinceLastPersist = 0;
    }
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "testRuns");
    await persistProgress("testRuns", message);
  }
  if ((summaryDetails.forecastAdjusted ?? 0) > 0) {
    logMessage(context, "Adjusted test run forecasts to int32 range", {
      adjustments: summaryDetails.forecastAdjusted
    });
  }
  if ((summaryDetails.forecastClamped ?? 0) > 0) {
    logMessage(context, "Clamped oversized test run forecasts to int32 range", {
      clamped: summaryDetails.forecastClamped
    });
  }
  if ((summaryDetails.elapsedAdjusted ?? 0) > 0) {
    logMessage(context, "Adjusted test run elapsed durations to int32 range", {
      adjustments: summaryDetails.elapsedAdjusted
    });
  }
  if ((summaryDetails.elapsedClamped ?? 0) > 0) {
    logMessage(context, "Clamped oversized test run elapsed durations", {
      clamped: summaryDetails.elapsedClamped
    });
  }
  return { summary, testRunIdMap };
};
var importTestRunCases = async (datasetRows, testRunIdMap, caseIdMap, caseMetaMap, userIdMap, statusIdMap, context, persistProgress) => {
  const runTestRows = datasetRows.get("run_tests") ?? [];
  const entityName = "testRunCases";
  const summary = {
    entity: "testRunCases",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      skippedUnselected: 0,
      importedUnselectedWithResults: 0
    }
  };
  const summaryDetails = summary.details;
  const testRunCaseIdMap = /* @__PURE__ */ new Map();
  if (runTestRows.length === 0) {
    logMessage(
      context,
      "No run_tests dataset found; skipping test run case import."
    );
    return { summary, testRunCaseIdMap };
  }
  initializeEntityProgress(context, entityName, runTestRows.length);
  const progressEntry = context.entityProgress[entityName];
  progressEntry.total = runTestRows.length;
  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(
    1,
    Math.floor(Math.max(runTestRows.length, 1) / 50)
  );
  const minProgressIntervalMs = 2e3;
  const reportProgress = async (force = false) => {
    if (runTestRows.length === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedRows - lastReportedCount;
    if (!force && deltaCount < minProgressDelta && now - lastReportAt < minProgressIntervalMs) {
      return;
    }
    progressEntry.mapped = Math.min(processedRows, progressEntry.total);
    const processed = progressEntry.mapped;
    const totalForStatus = progressEntry.total;
    lastReportedCount = processedRows;
    lastReportAt = now;
    const statusMessage = `Processing test run case imports (${processed.toLocaleString()} / ${totalForStatus.toLocaleString()} cases processed)`;
    await persistProgress(entityName, statusMessage);
  };
  const completedStatusRecords = await prisma.status.findMany({
    select: { id: true, isCompleted: true }
  });
  const completedStatusIds = /* @__PURE__ */ new Set();
  for (const record of completedStatusRecords) {
    if (record.isCompleted) {
      completedStatusIds.add(record.id);
    }
  }
  const orderCounters = /* @__PURE__ */ new Map();
  const processedPairs = /* @__PURE__ */ new Map();
  const runTestIdsWithResults = /* @__PURE__ */ new Set();
  const runResultRows = datasetRows.get("run_results") ?? [];
  if (runResultRows.length > 0) {
    for (const row of runResultRows) {
      const resultRecord = row;
      const runTestSourceId = toNumberValue(resultRecord.test_id);
      if (runTestSourceId !== null) {
        runTestIdsWithResults.add(runTestSourceId);
      }
    }
  }
  await reportProgress(true);
  const batchSize = Math.max(1, Math.floor(TEST_RUN_CASE_CHUNK_SIZE / 2));
  for (let start = 0; start < runTestRows.length; start += batchSize) {
    const batch = runTestRows.slice(start, start + batchSize);
    const mappedRecords = [];
    let duplicateMappingsInBatch = 0;
    for (const row of batch) {
      const record = row;
      processedRows += 1;
      const runTestSourceId = toNumberValue(record.id);
      const runSourceId = toNumberValue(record.run_id);
      const caseSourceId = toNumberValue(record.case_id);
      const caseName = toStringValue2(record.name) ?? `Imported Case ${caseSourceId ?? 0}`;
      if (runTestSourceId === null || runSourceId === null || caseSourceId === null) {
        decrementEntityTotal(context, "testRunCases");
        continue;
      }
      const isSelected = toBooleanValue(record.is_selected);
      const hasLinkedResults = runTestIdsWithResults.has(runTestSourceId);
      if (!isSelected && !hasLinkedResults) {
        summaryDetails.skippedUnselected += 1;
        decrementEntityTotal(context, "testRunCases");
        continue;
      }
      if (!isSelected && hasLinkedResults) {
        summaryDetails.importedUnselectedWithResults += 1;
      }
      const testRunId = testRunIdMap.get(runSourceId);
      if (!testRunId) {
        logMessage(
          context,
          "Skipping test run case due to missing run mapping",
          {
            runTestSourceId,
            runSourceId
          }
        );
        decrementEntityTotal(context, "testRunCases");
        continue;
      }
      let repositoryCaseId = caseIdMap.get(caseSourceId);
      if (!repositoryCaseId && caseSourceId !== null) {
        const meta = caseMetaMap.get(caseSourceId);
        if (meta) {
          const fallbackCase = await prisma.repositoryCases.findFirst({
            where: {
              projectId: meta.projectId,
              name: meta.name,
              isDeleted: false
            },
            select: { id: true }
          });
          if (fallbackCase) {
            repositoryCaseId = fallbackCase.id;
            caseIdMap.set(caseSourceId, fallbackCase.id);
          }
        }
      }
      if (!repositoryCaseId) {
        logMessage(
          context,
          "Skipping test run case due to missing repository case",
          {
            runTestSourceId,
            caseSourceId
          }
        );
        decrementEntityTotal(context, "testRunCases");
        continue;
      }
      const pairKey = `${testRunId}:${repositoryCaseId}`;
      const existingTestRunCaseId = processedPairs.get(pairKey);
      if (existingTestRunCaseId !== void 0) {
        testRunCaseIdMap.set(runTestSourceId, existingTestRunCaseId);
        summary.total += 1;
        summary.mapped += 1;
        duplicateMappingsInBatch += 1;
        continue;
      }
      const statusSourceId = toNumberValue(record.status_id);
      const statusId = statusSourceId !== null ? statusIdMap.get(statusSourceId) ?? null : null;
      const assignedSourceId = toNumberValue(record.assignee_id);
      const assignedToId = assignedSourceId !== null ? userIdMap.get(assignedSourceId) ?? null : null;
      const elapsedValue = toNumberValue(record.elapsed);
      const { value: normalizedElapsed } = normalizeEstimate(elapsedValue);
      const currentOrder = orderCounters.get(testRunId) ?? 0;
      orderCounters.set(testRunId, currentOrder + 1);
      const isCompleted = Boolean(statusId) && completedStatusIds.has(statusId);
      mappedRecords.push({
        record,
        runTestSourceId,
        data: {
          testRunId,
          repositoryCaseId,
          order: currentOrder,
          statusId: statusId ?? void 0,
          assignedToId: assignedToId ?? void 0,
          elapsed: normalizedElapsed ?? void 0,
          isCompleted
        }
      });
    }
    if (mappedRecords.length > 0) {
      const { createResult, persistedPairs } = await prisma.$transaction(
        async (tx) => {
          const createResult2 = await tx.testRunCases.createMany({
            data: mappedRecords.map((item) => item.data),
            skipDuplicates: true
          });
          const persistedPairs2 = await tx.testRunCases.findMany({
            where: {
              OR: mappedRecords.map((item) => ({
                testRunId: item.data.testRunId,
                repositoryCaseId: item.data.repositoryCaseId
              }))
            },
            select: {
              testRunId: true,
              repositoryCaseId: true,
              id: true
            }
          });
          return { createResult: createResult2, persistedPairs: persistedPairs2 };
        },
        {
          timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
          maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS
        }
      );
      summary.total += mappedRecords.length;
      summary.created += createResult.count;
      progressEntry.created += createResult.count;
      const sourceIdsByKey = /* @__PURE__ */ new Map();
      for (const item of mappedRecords) {
        const key = `${item.data.testRunId}:${item.data.repositoryCaseId}`;
        const sourceIds = sourceIdsByKey.get(key);
        if (sourceIds) {
          sourceIds.push(item.runTestSourceId);
        } else {
          sourceIdsByKey.set(key, [item.runTestSourceId]);
        }
      }
      for (const persisted of persistedPairs) {
        const key = `${persisted.testRunId}:${persisted.repositoryCaseId}`;
        processedPairs.set(key, persisted.id);
        const sourceIds = sourceIdsByKey.get(key) ?? [];
        if (sourceIds.length === 0) {
          continue;
        }
        for (const sourceId of sourceIds) {
          testRunCaseIdMap.set(sourceId, persisted.id);
        }
      }
      const createdCount = createResult.count;
      const mappedCount = mappedRecords.length > createdCount ? mappedRecords.length - createdCount : 0;
      incrementEntityProgress(
        context,
        "testRunCases",
        createdCount,
        mappedCount
      );
    }
    if (duplicateMappingsInBatch > 0) {
      incrementEntityProgress(
        context,
        "testRunCases",
        0,
        duplicateMappingsInBatch
      );
    }
    await reportProgress();
  }
  await reportProgress(true);
  return { summary, testRunCaseIdMap };
};
var importTestRunResults = async (datasetRows, testRunIdMap, testRunCaseIdMap, statusIdMap, userIdMap, resultFieldMap, importJob, context, persistProgress) => {
  const resultRows = datasetRows.get("run_results") ?? [];
  datasetRows.delete("run_results");
  const summary = {
    entity: "testRunResults",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      elapsedAdjusted: 0,
      elapsedClamped: 0,
      missingStatus: 0
    }
  };
  const summaryDetails = summary.details;
  const testRunResultIdMap = /* @__PURE__ */ new Map();
  const testRunCaseVersionCache = /* @__PURE__ */ new Map();
  if (resultRows.length === 0) {
    logMessage(
      context,
      "No run_results dataset found; skipping test run result import."
    );
    return { summary, testRunResultIdMap };
  }
  const untestedStatus = await prisma.status.findFirst({
    where: { systemName: "untested" },
    select: { id: true }
  });
  if (!untestedStatus) {
    throw new Error("Default 'untested' status not found in workspace");
  }
  const defaultStatusId = untestedStatus.id;
  initializeEntityProgress(context, "testRunResults", resultRows.length);
  let processedSinceLastPersist = 0;
  const chunkSize = Math.max(1, TEST_RUN_RESULT_CHUNK_SIZE);
  logMessage(context, `Processing test run results in batches of ${chunkSize}`);
  const processChunk = async (records) => {
    if (records.length === 0) {
      return;
    }
    await prisma.$transaction(
      async (tx) => {
        for (const record of records) {
          const resultSourceId = toNumberValue(record.id);
          const runSourceId = toNumberValue(record.run_id);
          const runTestSourceId = toNumberValue(record.test_id);
          if (resultSourceId === null || runSourceId === null || runTestSourceId === null) {
            decrementEntityTotal(context, "testRunResults");
            continue;
          }
          if (toBooleanValue(record.is_deleted)) {
            decrementEntityTotal(context, "testRunResults");
            continue;
          }
          const testRunId = testRunIdMap.get(runSourceId);
          if (!testRunId) {
            logMessage(
              context,
              "Skipping test run result due to missing run mapping",
              {
                resultSourceId,
                runSourceId
              }
            );
            decrementEntityTotal(context, "testRunResults");
            continue;
          }
          const testRunCaseId = testRunCaseIdMap.get(runTestSourceId);
          if (!testRunCaseId) {
            logMessage(
              context,
              "Skipping test run result due to missing run case mapping",
              {
                resultSourceId,
                runTestSourceId
              }
            );
            decrementEntityTotal(context, "testRunResults");
            continue;
          }
          const statusSourceId = toNumberValue(record.status_id);
          const statusId = statusSourceId !== null ? statusIdMap.get(statusSourceId) ?? defaultStatusId : defaultStatusId;
          const executedById = resolveUserId(
            userIdMap,
            importJob.createdById,
            record.created_by
          );
          const executedAt = toDateValue(record.created_at) ?? /* @__PURE__ */ new Date();
          const elapsedValue = toNumberValue(record.elapsed);
          const { value: normalizedElapsed, adjustment: elapsedAdjustment } = normalizeEstimate(elapsedValue);
          if (elapsedAdjustment === "microseconds" || elapsedAdjustment === "nanoseconds") {
            summaryDetails.elapsedAdjusted += 1;
          } else if (elapsedAdjustment === "milliseconds") {
            summaryDetails.elapsedAdjusted += 1;
          } else if (elapsedAdjustment === "clamped") {
            summaryDetails.elapsedClamped += 1;
          }
          const comment = toStringValue2(record.comment);
          let testRunCaseVersion = testRunCaseVersionCache.get(testRunCaseId);
          if (testRunCaseVersion === void 0) {
            const runCase = await tx.testRunCases.findUnique({
              where: { id: testRunCaseId },
              select: {
                repositoryCase: {
                  select: { currentVersion: true }
                }
              }
            });
            testRunCaseVersion = runCase?.repositoryCase?.currentVersion ?? 1;
            testRunCaseVersionCache.set(testRunCaseId, testRunCaseVersion);
          }
          const createdResult = await tx.testRunResults.create({
            data: {
              testRunId,
              testRunCaseId,
              testRunCaseVersion,
              statusId,
              executedById,
              executedAt,
              elapsed: normalizedElapsed ?? void 0,
              notes: comment ? toInputJsonValue(comment) : void 0
            }
          });
          testRunResultIdMap.set(resultSourceId, createdResult.id);
          for (const [key, rawValue] of Object.entries(record)) {
            if (!key.startsWith("custom_")) {
              continue;
            }
            const fieldName = key.replace(/^custom_/, "");
            const fieldId = resultFieldMap.get(fieldName);
            if (!fieldId) {
              continue;
            }
            if (rawValue === null || rawValue === void 0 || typeof rawValue === "string" && rawValue.trim().length === 0) {
              continue;
            }
            await tx.resultFieldValues.create({
              data: {
                testRunResultsId: createdResult.id,
                fieldId,
                value: toInputJsonValue(rawValue)
              }
            });
          }
          summary.total += 1;
          summary.created += 1;
          incrementEntityProgress(context, "testRunResults", 1, 0);
          processedSinceLastPersist += 1;
          if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL2) {
            const message = formatInProgressStatus(context, "testRunResults");
            await persistProgress("testRunResults", message);
            processedSinceLastPersist = 0;
          }
        }
      },
      {
        timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS
      }
    );
    clearTipTapCache();
  };
  while (resultRows.length > 0) {
    const chunkRecords = resultRows.splice(
      Math.max(resultRows.length - chunkSize, 0)
    );
    await processChunk(chunkRecords);
  }
  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "testRunResults");
    await persistProgress("testRunResults", message);
  }
  if ((summaryDetails.elapsedAdjusted ?? 0) > 0) {
    logMessage(context, "Adjusted test run result elapsed durations", {
      adjustments: summaryDetails.elapsedAdjusted
    });
  }
  if ((summaryDetails.elapsedClamped ?? 0) > 0) {
    logMessage(context, "Clamped oversized test run result elapsed durations", {
      clamped: summaryDetails.elapsedClamped
    });
  }
  if ((summaryDetails.missingStatus ?? 0) > 0) {
    logMessage(
      context,
      "Skipped test run results due to missing status mapping",
      {
        skipped: summaryDetails.missingStatus
      }
    );
  }
  resultRows.length = 0;
  clearTipTapCache();
  return { summary, testRunResultIdMap };
};
var importTestRunStepResults = async (datasetRows, testRunResultIdMap, testRunCaseIdMap, statusIdMap, _caseIdMap, importJob, context, persistProgress) => {
  const entityName = "testRunStepResults";
  const stepResultRows = datasetRows.get("run_result_steps") ?? [];
  const summary = {
    entity: entityName,
    total: 0,
    created: 0,
    mapped: 0
  };
  const plannedTotal = context.entityProgress[entityName]?.total ?? stepResultRows.length;
  const shouldStream = stepResultRows.length === 0 && plannedTotal > 0 && !!context.jobId;
  if (!shouldStream && stepResultRows.length === 0) {
    logMessage(
      context,
      "No run_result_steps dataset found; skipping step result import."
    );
    return summary;
  }
  const fetchBatchSize = 500;
  const rehydrateRow = (data, text1, text2, text3, text4) => {
    const cloned = typeof data === "object" && data !== null ? JSON.parse(JSON.stringify(data)) : {};
    const record = cloned && typeof cloned === "object" ? cloned : {};
    const textEntries = [
      ["text1", text1],
      ["text2", text2],
      ["text3", text3],
      ["text4", text4]
    ];
    for (const [key, value] of textEntries) {
      if (value !== null && value !== void 0 && record[key] === void 0) {
        record[key] = value;
      }
    }
    return record;
  };
  const createChunkIterator = () => {
    if (!shouldStream) {
      return (async function* () {
        for (let offset = 0; offset < stepResultRows.length; offset += fetchBatchSize) {
          const chunk = stepResultRows.slice(offset, offset + fetchBatchSize).map(
            (row) => typeof row === "object" && row !== null ? JSON.parse(JSON.stringify(row)) : {}
          );
          yield chunk;
        }
      })();
    }
    if (!context.jobId) {
      throw new Error(
        "importTestRunStepResults requires context.jobId for streaming"
      );
    }
    return (async function* () {
      let nextRowIndex = 0;
      while (true) {
        const stagedRows = await prisma.testmoImportStaging.findMany({
          where: {
            jobId: context.jobId,
            datasetName: "run_result_steps",
            rowIndex: {
              gte: nextRowIndex,
              lt: nextRowIndex + fetchBatchSize
            }
          },
          orderBy: {
            rowIndex: "asc"
          },
          select: {
            rowIndex: true,
            rowData: true,
            text1: true,
            text2: true,
            text3: true,
            text4: true
          }
        });
        if (stagedRows.length === 0) {
          break;
        }
        nextRowIndex = stagedRows[stagedRows.length - 1].rowIndex + 1;
        yield stagedRows.map(
          (row) => rehydrateRow(row.rowData, row.text1, row.text2, row.text3, row.text4)
        );
      }
    })();
  };
  const repositoryCaseIdByTestRunCaseId = /* @__PURE__ */ new Map();
  const missingRepositoryCaseIds = /* @__PURE__ */ new Set();
  const ensureRepositoryCasesLoaded = async (ids) => {
    const uniqueIds = Array.from(
      new Set(
        Array.from(ids).filter(
          (id) => !repositoryCaseIdByTestRunCaseId.has(id) && !missingRepositoryCaseIds.has(id)
        )
      )
    );
    if (uniqueIds.length === 0) {
      return;
    }
    const cases = await prisma.testRunCases.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, repositoryCaseId: true }
    });
    const foundIds = /* @__PURE__ */ new Set();
    for (const testRunCase of cases) {
      repositoryCaseIdByTestRunCaseId.set(
        testRunCase.id,
        testRunCase.repositoryCaseId
      );
      foundIds.add(testRunCase.id);
    }
    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        missingRepositoryCaseIds.add(id);
      }
    }
  };
  const untestedStatus = await prisma.status.findFirst({
    where: { systemName: "untested" },
    select: { id: true }
  });
  if (!untestedStatus) {
    throw new Error("Default 'untested' status not found");
  }
  const defaultStatusId = untestedStatus.id;
  initializeEntityProgress(context, entityName, plannedTotal);
  const chunkIterator = createChunkIterator();
  let processedCount = 0;
  for await (const chunk of chunkIterator) {
    const stepEntries = [];
    const caseIdsForChunk = /* @__PURE__ */ new Set();
    for (const row of chunk) {
      const record = row;
      const resultSourceId = toNumberValue(record.result_id);
      const testRunCaseSourceId = toNumberValue(record.test_id);
      const displayOrder = toNumberValue(record.display_order);
      if (resultSourceId === null || testRunCaseSourceId === null || displayOrder === null) {
        decrementEntityTotal(context, entityName);
        continue;
      }
      const resultId = testRunResultIdMap.get(resultSourceId);
      const testRunCaseId = testRunCaseIdMap.get(testRunCaseSourceId);
      if (!resultId || !testRunCaseId) {
        decrementEntityTotal(context, entityName);
        continue;
      }
      caseIdsForChunk.add(testRunCaseId);
      stepEntries.push({
        resultId,
        testRunCaseId,
        displayOrder,
        record
      });
    }
    if (stepEntries.length === 0) {
      continue;
    }
    await ensureRepositoryCasesLoaded(caseIdsForChunk);
    for (const stepEntry of stepEntries) {
      const { resultId, testRunCaseId, displayOrder, record } = stepEntry;
      const repositoryCaseId = repositoryCaseIdByTestRunCaseId.get(testRunCaseId);
      if (!repositoryCaseId) {
        decrementEntityTotal(context, entityName);
        continue;
      }
      const stepAction = toStringValue2(record.text1);
      const stepData = toStringValue2(record.text2);
      const expectedResult = toStringValue2(record.text3);
      const expectedResultData = toStringValue2(record.text4);
      let stepContent = null;
      if (stepAction || stepData) {
        stepContent = stepAction || "";
        if (stepData) {
          stepContent += (stepContent ? "\n" : "") + `<data>${stepData}</data>`;
        }
      }
      let expectedResultContent = null;
      if (expectedResult || expectedResultData) {
        expectedResultContent = expectedResult || "";
        if (expectedResultData) {
          expectedResultContent += (expectedResultContent ? "\n" : "") + `<data>${expectedResultData}</data>`;
        }
      }
      const stepPayload = stepContent ? convertToTipTapJsonValue(stepContent) : null;
      const expectedPayload = expectedResultContent ? convertToTipTapJsonValue(expectedResultContent) : null;
      const createdStep = await prisma.steps.create({
        data: {
          testCaseId: repositoryCaseId,
          order: displayOrder,
          step: stepPayload ? JSON.stringify(stepPayload) : void 0,
          expectedResult: expectedPayload ? JSON.stringify(expectedPayload) : void 0
        }
      });
      const statusSourceId = toNumberValue(record.status_id);
      const statusId = statusSourceId !== null ? statusIdMap.get(statusSourceId) ?? defaultStatusId : defaultStatusId;
      const comment = toStringValue2(record.comment);
      const elapsed = toNumberValue(record.elapsed);
      try {
        await prisma.testRunStepResults.create({
          data: {
            testRunResultId: resultId,
            stepId: createdStep.id,
            statusId,
            notes: comment ? toInputJsonValue(comment) : void 0,
            elapsed: elapsed ?? void 0
          }
        });
        summary.total += 1;
        summary.created += 1;
      } catch (error) {
        logMessage(context, "Skipping duplicate step result", {
          resultId,
          stepId: createdStep.id,
          error: String(error)
        });
        decrementEntityTotal(context, entityName);
      }
      processedCount += 1;
      incrementEntityProgress(context, entityName, 1, 0);
      if (processedCount % PROGRESS_UPDATE_INTERVAL2 === 0) {
        const message = formatInProgressStatus(context, entityName);
        await persistProgress(entityName, message);
      }
    }
  }
  return summary;
};
async function importStatuses(tx, configuration) {
  const summary = {
    entity: "statuses",
    total: 0,
    created: 0,
    mapped: 0
  };
  const scopeRecords = await tx.statusScope.findMany({ select: { id: true } });
  const availableScopeIds = scopeRecords.map((record) => record.id);
  if (availableScopeIds.length === 0) {
    throw new Error(
      "No status scopes are configured in the workspace. Unable to import statuses."
    );
  }
  const colorCacheById = /* @__PURE__ */ new Map();
  const colorCacheByHex = /* @__PURE__ */ new Map();
  const resolveColorId = async (desiredId, desiredHex) => {
    if (desiredId !== null && desiredId !== void 0) {
      if (!colorCacheById.has(desiredId)) {
        const exists = await tx.color.findUnique({ where: { id: desiredId } });
        if (!exists) {
          throw new Error(
            `Color ${desiredId} configured for a status does not exist.`
          );
        }
        colorCacheById.set(desiredId, true);
      }
      return desiredId;
    }
    const normalizedHex = normalizeColorHex(desiredHex) ?? DEFAULT_STATUS_COLOR_HEX;
    if (colorCacheByHex.has(normalizedHex)) {
      return colorCacheByHex.get(normalizedHex);
    }
    const color = await tx.color.findFirst({ where: { value: normalizedHex } });
    if (color) {
      colorCacheByHex.set(normalizedHex, color.id);
      return color.id;
    }
    if (normalizedHex !== DEFAULT_STATUS_COLOR_HEX) {
      return resolveColorId(void 0, DEFAULT_STATUS_COLOR_HEX);
    }
    throw new Error(
      "Unable to resolve a color to apply to an imported status."
    );
  };
  for (const [key, config] of Object.entries(configuration.statuses ?? {})) {
    const statusId = Number(key);
    if (!Number.isFinite(statusId) || !config) {
      continue;
    }
    summary.total += 1;
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === void 0) {
        throw new Error(
          `Status ${statusId} is configured to map but no target status was provided.`
        );
      }
      const existing = await tx.status.findUnique({
        where: { id: config.mappedTo }
      });
      if (!existing) {
        throw new Error(
          `Status ${config.mappedTo} selected for mapping was not found.`
        );
      }
      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Status ${statusId} requires a display name before it can be created.`
      );
    }
    let systemName = (config.systemName ?? "").trim();
    if (!SYSTEM_NAME_REGEX2.test(systemName)) {
      systemName = generateSystemName2(name);
    }
    if (!SYSTEM_NAME_REGEX2.test(systemName)) {
      throw new Error(
        `Status "${name}" requires a valid system name (letters, numbers, underscore, starting with a letter).`
      );
    }
    const existingByName = await tx.status.findFirst({
      where: {
        name,
        isDeleted: false
      }
    });
    if (existingByName) {
      config.action = "map";
      config.mappedTo = existingByName.id;
      config.name = existingByName.name;
      config.systemName = existingByName.systemName;
      summary.mapped += 1;
      continue;
    }
    const existingStatus = await tx.status.findFirst({
      where: {
        systemName,
        isDeleted: false
      }
    });
    if (existingStatus) {
      config.action = "map";
      config.mappedTo = existingStatus.id;
      config.systemName = existingStatus.systemName;
      summary.mapped += 1;
      continue;
    }
    const colorId = await resolveColorId(
      config.colorId ?? null,
      config.colorHex ?? null
    );
    let scopeIds = Array.isArray(config.scopeIds) ? config.scopeIds.filter(
      (value) => Number.isFinite(value)
    ) : [];
    scopeIds = Array.from(new Set(scopeIds));
    if (scopeIds.length === 0) {
      scopeIds = availableScopeIds;
    }
    const aliases = (config.aliases ?? "").trim();
    let created;
    try {
      created = await tx.status.create({
        data: {
          name,
          systemName,
          aliases: aliases || null,
          colorId,
          isEnabled: config.isEnabled ?? true,
          isSuccess: config.isSuccess ?? false,
          isFailure: config.isFailure ?? false,
          isCompleted: config.isCompleted ?? false
        }
      });
    } catch (error) {
      if (error instanceof import_client5.Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await tx.status.findFirst({
          where: {
            OR: [{ name }, { systemName }],
            isDeleted: false
          }
        });
        if (duplicate) {
          config.action = "map";
          config.mappedTo = duplicate.id;
          config.name = duplicate.name;
          config.systemName = duplicate.systemName;
          summary.mapped += 1;
          continue;
        }
      }
      throw error;
    }
    if (scopeIds.length > 0) {
      await tx.statusScopeAssignment.createMany({
        data: scopeIds.map((scopeId) => ({
          statusId: created.id,
          scopeId
        })),
        skipDuplicates: true
      });
    }
    config.action = "map";
    config.mappedTo = created.id;
    config.systemName = systemName;
    config.colorId = colorId;
    config.scopeIds = scopeIds;
    config.aliases = aliases || null;
    summary.created += 1;
  }
  return summary;
}
async function processImportMode(importJob, jobId) {
  if (FINAL_STATUSES.has(importJob.status)) {
    return { status: importJob.status };
  }
  if (!importJob.configuration) {
    throw new Error(
      `Testmo import job ${jobId} cannot start background import without configuration`
    );
  }
  const normalizedConfiguration = normalizeMappingConfiguration(
    importJob.configuration
  );
  const datasetRecords = await prisma.testmoImportDataset.findMany({
    where: { jobId },
    select: {
      name: true,
      rowCount: true
    }
  });
  const loadDatasetFromStaging = async (datasetName) => {
    const mapStagedRow = (row) => {
      const data = typeof row.rowData === "object" && row.rowData !== null ? JSON.parse(JSON.stringify(row.rowData)) : row.rowData;
      if (data && typeof data === "object") {
        const record = data;
        if (row.fieldValue !== null && row.fieldValue !== void 0 && record.value === void 0) {
          record.value = row.fieldValue;
        }
        if (row.fieldName && (record.name === void 0 || record.name === null)) {
          record.name = row.fieldName;
        }
        const textKeys = [
          ["text1", row.text1],
          ["text2", row.text2],
          ["text3", row.text3],
          ["text4", row.text4]
        ];
        for (const [key, value] of textKeys) {
          if (value !== null && value !== void 0 && record[key] === void 0) {
            record[key] = value;
          }
        }
      }
      return data;
    };
    try {
      const stagedRows = await prisma.testmoImportStaging.findMany({
        where: {
          jobId,
          datasetName
        },
        orderBy: {
          rowIndex: "asc"
        },
        select: {
          rowData: true,
          fieldName: true,
          fieldValue: true,
          text1: true,
          text2: true,
          text3: true,
          text4: true
        }
      });
      return stagedRows.map(mapStagedRow);
    } catch (error) {
      logMessage(
        context,
        `Error loading ${datasetName} in single batch, trying batched approach: ${error}`
      );
      const totalCount = await prisma.testmoImportStaging.count({
        where: {
          jobId,
          datasetName
        }
      });
      const batchSize = datasetName === "automation_run_test_fields" ? 50 : 100;
      const allRows = [];
      for (let offset = 0; offset < totalCount; offset += batchSize) {
        try {
          const stagedRows = await prisma.testmoImportStaging.findMany({
            where: {
              jobId,
              datasetName
            },
            orderBy: {
              rowIndex: "asc"
            },
            skip: offset,
            take: batchSize,
            select: {
              rowData: true,
              fieldName: true,
              fieldValue: true,
              text1: true,
              text2: true,
              text3: true,
              text4: true
            }
          });
          const rows = stagedRows.map(mapStagedRow);
          allRows.push(...rows);
          logMessage(
            context,
            `Loaded batch ${offset}-${offset + batchSize} of ${datasetName} (${allRows.length}/${totalCount})`
          );
        } catch (batchError) {
          logMessage(
            context,
            `Error loading batch ${offset}-${offset + batchSize} of ${datasetName}, skipping: ${batchError}`
          );
        }
      }
      return allRows;
    }
  };
  const SMALL_DATASETS = /* @__PURE__ */ new Set([
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
    "milestone_types"
  ]);
  const datasetRowsByName = /* @__PURE__ */ new Map();
  const datasetRowCountByName = /* @__PURE__ */ new Map();
  for (const record of datasetRecords) {
    datasetRowCountByName.set(record.name, record.rowCount);
    if (SMALL_DATASETS.has(record.name)) {
      const rows = await loadDatasetFromStaging(record.name);
      datasetRowsByName.set(record.name, rows);
    } else {
      datasetRowsByName.set(record.name, []);
    }
  }
  const context = createInitialContext(jobId);
  logMessage(context, "Background import started.", { jobId });
  let currentEntity = null;
  const entityTotals = computeEntityTotals(
    normalizedConfiguration,
    datasetRowsByName,
    datasetRowCountByName
  );
  let plannedTotalCount = 0;
  for (const [entity, total] of entityTotals) {
    if (total > 0) {
      initializeEntityProgress(context, entity, total);
      plannedTotalCount += total;
    }
  }
  const formatEntityLabel = (entity) => entity.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
  const formatSummaryStatus = (summary) => {
    const label = formatEntityLabel(summary.entity);
    return `${label}: ${summary.total} processed \u2014 ${summary.created} created \xB7 ${summary.mapped} mapped`;
  };
  const persistProgress = async (entity, statusMessage) => {
    currentEntity = entity;
    try {
      const now = Date.now();
      const timeSinceLastUpdate = now - context.lastProgressUpdate;
      const metrics = calculateProgressMetrics(context, plannedTotalCount);
      const data = {
        currentEntity: entity,
        processedCount: context.processedCount,
        totalCount: plannedTotalCount,
        activityLog: toInputJsonValue(context.activityLog),
        entityProgress: toInputJsonValue(context.entityProgress),
        estimatedTimeRemaining: metrics.estimatedTimeRemaining,
        processingRate: metrics.processingRate
      };
      if (statusMessage) {
        data.statusMessage = statusMessage;
      }
      await prisma.testmoImportJob.update({
        where: { id: jobId },
        data
      });
      context.lastProgressUpdate = now;
    } catch (progressError) {
      console.error(
        `Failed to update Testmo import progress for job ${jobId}`,
        progressError
      );
    }
  };
  const importStart = /* @__PURE__ */ new Date();
  await prisma.testmoImportJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      phase: "IMPORTING",
      statusMessage: "Background import started",
      lastImportStartedAt: importStart,
      processedCount: 0,
      errorCount: 0,
      skippedCount: 0,
      totalCount: plannedTotalCount,
      currentEntity: null,
      estimatedTimeRemaining: null,
      processingRate: null,
      activityLog: toInputJsonValue(context.activityLog),
      entityProgress: toInputJsonValue(context.entityProgress)
    }
  });
  try {
    const withTransaction = async (operation, options) => {
      return prisma.$transaction(operation, {
        timeout: options?.timeoutMs ?? IMPORT_TRANSACTION_TIMEOUT_MS,
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS
      });
    };
    logMessage(context, "Processing workflow mappings");
    await persistProgress("workflows", "Processing workflow mappings");
    const workflowSummary = await withTransaction(
      (tx) => importWorkflows(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, workflowSummary);
    await persistProgress("workflows", formatSummaryStatus(workflowSummary));
    logMessage(context, "Processing status mappings");
    await persistProgress("statuses", "Processing status mappings");
    const statusSummary = await withTransaction(
      (tx) => importStatuses(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, statusSummary);
    await persistProgress("statuses", formatSummaryStatus(statusSummary));
    logMessage(context, "Processing group mappings");
    await persistProgress("groups", "Processing group mappings");
    const groupSummary = await withTransaction(
      (tx) => importGroups(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, groupSummary);
    await persistProgress("groups", formatSummaryStatus(groupSummary));
    logMessage(context, "Processing tag mappings");
    await persistProgress("tags", "Processing tag mappings");
    const tagSummary = await withTransaction(
      (tx) => importTags(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, tagSummary);
    await persistProgress("tags", formatSummaryStatus(tagSummary));
    logMessage(context, "Processing role mappings");
    await persistProgress("roles", "Processing role mappings");
    const roleSummary = await withTransaction(
      (tx) => importRoles(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, roleSummary);
    await persistProgress("roles", formatSummaryStatus(roleSummary));
    logMessage(context, "Processing milestone type mappings");
    await persistProgress(
      "milestoneTypes",
      "Processing milestone type mappings"
    );
    const milestoneSummary = await withTransaction(
      (tx) => importMilestoneTypes(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, milestoneSummary);
    await persistProgress(
      "milestoneTypes",
      formatSummaryStatus(milestoneSummary)
    );
    logMessage(context, "Processing configuration mappings");
    await persistProgress(
      "configurations",
      "Processing configuration mappings"
    );
    const configurationSummary = await withTransaction(
      (tx) => importConfigurations(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, configurationSummary);
    await persistProgress(
      "configurations",
      formatSummaryStatus(configurationSummary)
    );
    logMessage(context, "Processing template mappings");
    await persistProgress("templates", "Processing template mappings");
    const { summary: templateSummary, templateMap } = await withTransaction(
      (tx) => importTemplates(tx, normalizedConfiguration)
    );
    recordEntitySummary(context, templateSummary);
    await persistProgress("templates", formatSummaryStatus(templateSummary));
    let caseFieldMap = /* @__PURE__ */ new Map();
    let resultFieldMap = /* @__PURE__ */ new Map();
    const initialFieldMaps = buildTemplateFieldMaps(
      normalizedConfiguration.templateFields ?? {}
    );
    caseFieldMap = initialFieldMaps.caseFields;
    resultFieldMap = initialFieldMaps.resultFields;
    logMessage(context, "Processing template field mappings");
    await persistProgress(
      "templateFields",
      "Processing template field mappings"
    );
    const templateFieldSummary = await withTransaction(
      (tx) => importTemplateFields(
        tx,
        normalizedConfiguration,
        templateMap,
        datasetRowsByName
      )
    );
    recordEntitySummary(context, templateFieldSummary);
    await persistProgress(
      "templateFields",
      formatSummaryStatus(templateFieldSummary)
    );
    releaseDatasetRows(datasetRowsByName, "template_fields");
    const updatedFieldMaps = buildTemplateFieldMaps(
      normalizedConfiguration.templateFields ?? {}
    );
    caseFieldMap = updatedFieldMaps.caseFields;
    resultFieldMap = updatedFieldMaps.resultFields;
    logMessage(context, "Processing user mappings");
    await persistProgress("users", "Processing user mappings");
    const userSummary = await withTransaction(
      (tx) => importUsers(tx, normalizedConfiguration, importJob)
    );
    recordEntitySummary(context, userSummary);
    await persistProgress("users", formatSummaryStatus(userSummary));
    logMessage(context, "Processing user group assignments");
    await persistProgress("userGroups", "Processing user group assignments");
    const userGroupsSummary = await withTransaction(
      (tx) => importUserGroups(tx, normalizedConfiguration, datasetRowsByName)
    );
    recordEntitySummary(context, userGroupsSummary);
    await persistProgress("userGroups", formatSummaryStatus(userGroupsSummary));
    const workflowIdMap = buildNumberIdMap(
      normalizedConfiguration.workflows ?? {}
    );
    const statusIdMap = buildNumberIdMap(
      normalizedConfiguration.statuses ?? {}
    );
    const configurationIdMap = buildNumberIdMap(
      normalizedConfiguration.configurations ?? {}
    );
    const milestoneTypeIdMap = buildNumberIdMap(
      normalizedConfiguration.milestoneTypes ?? {}
    );
    const templateIdMap = buildNumberIdMap(
      normalizedConfiguration.templates ?? {}
    );
    const userIdMap = buildStringIdMap(normalizedConfiguration.users ?? {});
    logMessage(context, "Processing project imports");
    await persistProgress("projects", "Processing project imports");
    if (datasetRowsByName.get("projects")?.length === 0) {
      datasetRowsByName.set(
        "projects",
        await loadDatasetFromStaging("projects")
      );
    }
    const projectImport = await withTransaction(
      (tx) => importProjects(
        tx,
        datasetRowsByName,
        importJob,
        userIdMap,
        statusIdMap,
        workflowIdMap,
        milestoneTypeIdMap,
        templateIdMap,
        templateMap,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, projectImport.summary);
    await persistProgress(
      "projects",
      formatSummaryStatus(projectImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "projects");
    logMessage(context, "Processing project links");
    await persistProgress("projectLinks", "Processing project links");
    if (datasetRowsByName.get("project_links")?.length === 0) {
      datasetRowsByName.set(
        "project_links",
        await loadDatasetFromStaging("project_links")
      );
    }
    const projectLinksImport = await withTransaction(
      (tx) => importProjectLinks(
        tx,
        normalizedConfiguration,
        datasetRowsByName,
        projectImport.projectIdMap,
        context
      )
    );
    recordEntitySummary(context, projectLinksImport);
    await persistProgress(
      "projectLinks",
      formatSummaryStatus(projectLinksImport)
    );
    releaseDatasetRows(datasetRowsByName, "project_links");
    logMessage(context, "Processing milestone imports");
    await persistProgress("milestones", "Processing milestone imports");
    if (datasetRowsByName.get("milestones")?.length === 0) {
      datasetRowsByName.set(
        "milestones",
        await loadDatasetFromStaging("milestones")
      );
    }
    const milestoneImport = await withTransaction(
      (tx) => importMilestones(
        tx,
        datasetRowsByName,
        projectImport.projectIdMap,
        milestoneTypeIdMap,
        userIdMap,
        importJob,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, milestoneImport.summary);
    await persistProgress(
      "milestones",
      formatSummaryStatus(milestoneImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "milestones");
    logMessage(context, "Processing milestone links");
    await persistProgress("milestoneLinks", "Processing milestone links");
    if (datasetRowsByName.get("milestone_links")?.length === 0) {
      datasetRowsByName.set(
        "milestone_links",
        await loadDatasetFromStaging("milestone_links")
      );
    }
    const milestoneLinksImport = await withTransaction(
      (tx) => importMilestoneLinks(
        tx,
        normalizedConfiguration,
        datasetRowsByName,
        milestoneImport.milestoneIdMap,
        context
      )
    );
    recordEntitySummary(context, milestoneLinksImport);
    await persistProgress(
      "milestoneLinks",
      formatSummaryStatus(milestoneLinksImport)
    );
    releaseDatasetRows(datasetRowsByName, "milestone_links");
    logMessage(context, "Processing session imports");
    await persistProgress("sessions", "Processing session imports");
    if (datasetRowsByName.get("sessions")?.length === 0) {
      datasetRowsByName.set(
        "sessions",
        await loadDatasetFromStaging("sessions")
      );
    }
    const sessionImport = await withTransaction(
      (tx) => importSessions(
        tx,
        datasetRowsByName,
        projectImport.projectIdMap,
        milestoneImport.milestoneIdMap,
        configurationIdMap,
        workflowIdMap,
        userIdMap,
        templateIdMap,
        importJob,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, sessionImport.summary);
    await persistProgress(
      "sessions",
      formatSummaryStatus(sessionImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "sessions");
    logMessage(context, "Processing session results imports");
    await persistProgress(
      "sessionResults",
      "Processing session results imports"
    );
    if (datasetRowsByName.get("session_results")?.length === 0) {
      datasetRowsByName.set(
        "session_results",
        await loadDatasetFromStaging("session_results")
      );
    }
    const sessionResultsImport = await withTransaction(
      (tx) => importSessionResults(
        tx,
        datasetRowsByName,
        sessionImport.sessionIdMap,
        statusIdMap,
        userIdMap,
        importJob,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, sessionResultsImport.summary);
    await persistProgress(
      "sessionResults",
      formatSummaryStatus(sessionResultsImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "session_results");
    logMessage(context, "Processing session tag assignments");
    await persistProgress("sessionTags", "Processing session tag assignments");
    if (datasetRowsByName.get("session_tags")?.length === 0) {
      datasetRowsByName.set(
        "session_tags",
        await loadDatasetFromStaging("session_tags")
      );
    }
    const sessionTagsSummary = await withTransaction(
      (tx) => importSessionTags(
        tx,
        normalizedConfiguration,
        datasetRowsByName,
        sessionImport.sessionIdMap
      )
    );
    recordEntitySummary(context, sessionTagsSummary);
    await persistProgress(
      "sessionTags",
      formatSummaryStatus(sessionTagsSummary)
    );
    releaseDatasetRows(datasetRowsByName, "session_tags");
    if (datasetRowsByName.get("field_values")?.length === 0) {
      datasetRowsByName.set(
        "field_values",
        await loadDatasetFromStaging("field_values")
      );
    }
    const testmoFieldValueMap = /* @__PURE__ */ new Map();
    const fieldValueRows = datasetRowsByName.get("field_values") ?? [];
    for (const row of fieldValueRows) {
      const record = row;
      const id = toNumberValue(record.id);
      const fieldId = toNumberValue(record.field_id);
      const name = toStringValue2(record.name);
      if (id !== null && fieldId !== null && name) {
        testmoFieldValueMap.set(id, { fieldId, name });
      }
    }
    logMessage(context, "Processing repository imports");
    await persistProgress("repositories", "Processing repository imports");
    if (datasetRowsByName.get("repositories")?.length === 0) {
      datasetRowsByName.set(
        "repositories",
        await loadDatasetFromStaging("repositories")
      );
    }
    const repositoryImport = await withTransaction(
      (tx) => importRepositories(
        tx,
        datasetRowsByName,
        projectImport.projectIdMap,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, repositoryImport.summary);
    await persistProgress(
      "repositories",
      formatSummaryStatus(repositoryImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "repositories");
    logMessage(context, "Processing repository folders");
    await persistProgress("repositoryFolders", "Processing repository folders");
    if (datasetRowsByName.get("repository_folders")?.length === 0) {
      datasetRowsByName.set(
        "repository_folders",
        await loadDatasetFromStaging("repository_folders")
      );
    }
    if (repositoryImport.masterRepositoryIds.size > 0) {
      const filtered = (datasetRowsByName.get("repository_folders") ?? []).filter(
        (row) => {
          const repoId = toNumberValue(row.repo_id);
          return repoId === null ? true : repositoryImport.masterRepositoryIds.has(repoId);
        }
      );
      datasetRowsByName.set("repository_folders", filtered);
    }
    const folderImport = await importRepositoryFolders(
      datasetRowsByName,
      projectImport.projectIdMap,
      repositoryImport.repositoryIdMap,
      repositoryImport.canonicalRepoIdByProject,
      importJob,
      userIdMap,
      context,
      persistProgress
    );
    recordEntitySummary(context, folderImport.summary);
    await persistProgress(
      "repositoryFolders",
      formatSummaryStatus(folderImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "repository_folders");
    logMessage(context, "Processing repository cases");
    await persistProgress("repositoryCases", "Processing repository cases");
    if (datasetRowsByName.get("repository_cases")?.length === 0) {
      datasetRowsByName.set(
        "repository_cases",
        await loadDatasetFromStaging("repository_cases")
      );
    }
    if (repositoryImport.masterRepositoryIds.size > 0) {
      const filteredCases = datasetRowsByName.get("repository_cases")?.filter((row) => {
        const repoId = toNumberValue(row.repo_id);
        return repoId === null ? true : repositoryImport.masterRepositoryIds.has(repoId);
      }) ?? [];
      datasetRowsByName.set("repository_cases", filteredCases);
    }
    if (datasetRowsByName.get("repository_case_steps")?.length === 0) {
      datasetRowsByName.set(
        "repository_case_steps",
        await loadDatasetFromStaging("repository_case_steps")
      );
    }
    if (repositoryImport.masterRepositoryIds.size > 0) {
      const filteredSteps = datasetRowsByName.get("repository_case_steps")?.filter((row) => {
        const repoId = toNumberValue(row.repo_id);
        return repoId === null ? true : repositoryImport.masterRepositoryIds.has(repoId);
      }) ?? [];
      datasetRowsByName.set("repository_case_steps", filteredSteps);
    }
    if (!datasetRowsByName.has("repository_case_values") || datasetRowsByName.get("repository_case_values")?.length === 0) {
      const caseValuesData = await loadDatasetFromStaging(
        "repository_case_values"
      );
      datasetRowsByName.set("repository_case_values", caseValuesData);
    }
    if (repositoryImport.masterRepositoryIds.size > 0) {
      const filteredCaseValues = datasetRowsByName.get("repository_case_values")?.filter((row) => {
        const repoId = toNumberValue(row.repo_id);
        return repoId === null ? true : repositoryImport.masterRepositoryIds.has(repoId);
      }) ?? [];
      datasetRowsByName.set("repository_case_values", filteredCaseValues);
    }
    const caseImport = await importRepositoryCases(
      datasetRowsByName,
      projectImport.projectIdMap,
      repositoryImport.repositoryIdMap,
      repositoryImport.canonicalRepoIdByProject,
      folderImport.folderIdMap,
      folderImport.repositoryRootFolderMap,
      templateIdMap,
      templateMap,
      workflowIdMap,
      userIdMap,
      caseFieldMap,
      testmoFieldValueMap,
      normalizedConfiguration,
      importJob,
      context,
      persistProgress
    );
    recordEntitySummary(context, caseImport.summary);
    await persistProgress(
      "repositoryCases",
      formatSummaryStatus(caseImport.summary)
    );
    releaseDatasetRows(
      datasetRowsByName,
      "repository_cases",
      "repository_case_steps",
      "templates"
    );
    logMessage(context, "Processing repository case tag assignments");
    await persistProgress(
      "repositoryCaseTags",
      "Processing repository case tag assignments"
    );
    if (datasetRowsByName.get("repository_case_tags")?.length === 0) {
      datasetRowsByName.set(
        "repository_case_tags",
        await loadDatasetFromStaging("repository_case_tags")
      );
    }
    const repositoryCaseTagsSummary = await withTransaction(
      (tx) => importRepositoryCaseTags(
        tx,
        normalizedConfiguration,
        datasetRowsByName,
        caseImport.caseIdMap
      )
    );
    recordEntitySummary(context, repositoryCaseTagsSummary);
    await persistProgress(
      "repositoryCaseTags",
      formatSummaryStatus(repositoryCaseTagsSummary)
    );
    releaseDatasetRows(datasetRowsByName, "repository_case_tags");
    logMessage(context, "Processing automation case imports");
    await persistProgress(
      "automationCases",
      "Processing automation case imports"
    );
    if (datasetRowsByName.get("automation_cases")?.length === 0) {
      datasetRowsByName.set(
        "automation_cases",
        await loadDatasetFromStaging("automation_cases")
      );
    }
    const automationCaseImport = await importAutomationCases(
      prisma,
      normalizedConfiguration,
      datasetRowsByName,
      projectImport.projectIdMap,
      repositoryImport.repositoryIdMap,
      folderImport.folderIdMap,
      templateIdMap,
      projectImport.defaultTemplateIdByProject,
      workflowIdMap,
      context,
      persistProgress,
      {
        chunkSize: AUTOMATION_CASE_CHUNK_SIZE,
        transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, automationCaseImport.summary);
    await persistProgress(
      "automationCases",
      formatSummaryStatus(automationCaseImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "automation_cases");
    const automationCaseProjectMap = automationCaseImport.automationCaseProjectMap;
    logMessage(context, "Processing automation run imports");
    await persistProgress(
      "automationRuns",
      "Processing automation run imports"
    );
    if (datasetRowsByName.get("automation_runs")?.length === 0) {
      datasetRowsByName.set(
        "automation_runs",
        await loadDatasetFromStaging("automation_runs")
      );
    }
    const automationRunImport = await importAutomationRuns(
      prisma,
      normalizedConfiguration,
      datasetRowsByName,
      projectImport.projectIdMap,
      configurationIdMap,
      milestoneImport.milestoneIdMap,
      workflowIdMap,
      userIdMap,
      importJob.createdById,
      context,
      persistProgress,
      {
        chunkSize: AUTOMATION_RUN_CHUNK_SIZE,
        transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, automationRunImport.summary);
    await persistProgress(
      "automationRuns",
      formatSummaryStatus(automationRunImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "automation_runs");
    logMessage(context, "Processing automation run test imports");
    await persistProgress(
      "automationRunTests",
      "Processing automation run test imports"
    );
    if (datasetRowsByName.get("automation_run_tests")?.length === 0) {
      datasetRowsByName.set(
        "automation_run_tests",
        await loadDatasetFromStaging("automation_run_tests")
      );
    }
    const automationRunTestImport = await importAutomationRunTests(
      prisma,
      normalizedConfiguration,
      datasetRowsByName,
      projectImport.projectIdMap,
      automationRunImport.testRunIdMap,
      automationRunImport.testSuiteIdMap,
      automationRunImport.testRunTimestampMap,
      automationRunImport.testRunProjectIdMap,
      automationRunImport.testRunTestmoProjectIdMap,
      automationCaseProjectMap,
      statusIdMap,
      userIdMap,
      importJob.createdById,
      context,
      persistProgress,
      {
        chunkSize: AUTOMATION_RUN_TEST_CHUNK_SIZE,
        transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS
      }
    );
    const automationRunTestSummary = automationRunTestImport.summary;
    const automationRunTestCaseMap = automationRunTestImport.testRunCaseIdMap;
    const automationRunJunitResultMap = automationRunTestImport.junitResultIdMap;
    recordEntitySummary(context, automationRunTestSummary);
    await persistProgress(
      "automationRunTests",
      formatSummaryStatus(automationRunTestSummary)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_tests");
    logMessage(context, "Processing automation run fields");
    await persistProgress(
      "automationRunFields",
      "Processing automation run fields"
    );
    if (datasetRowsByName.get("automation_run_fields")?.length === 0) {
      datasetRowsByName.set(
        "automation_run_fields",
        await loadDatasetFromStaging("automation_run_fields")
      );
    }
    const automationRunFieldsImport = await importAutomationRunFields(
      prisma,
      normalizedConfiguration,
      datasetRowsByName,
      projectImport.projectIdMap,
      automationRunImport.testRunIdMap,
      context,
      persistProgress,
      {
        chunkSize: AUTOMATION_RUN_FIELD_CHUNK_SIZE,
        transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, automationRunFieldsImport);
    await persistProgress(
      "automationRunFields",
      formatSummaryStatus(automationRunFieldsImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_fields");
    logMessage(context, "Processing automation run links");
    await persistProgress(
      "automationRunLinks",
      "Processing automation run links"
    );
    if (datasetRowsByName.get("automation_run_links")?.length === 0) {
      datasetRowsByName.set(
        "automation_run_links",
        await loadDatasetFromStaging("automation_run_links")
      );
    }
    const automationRunLinksImport = await importAutomationRunLinks(
      prisma,
      normalizedConfiguration,
      datasetRowsByName,
      projectImport.projectIdMap,
      automationRunImport.testRunIdMap,
      userIdMap,
      importJob.createdById,
      context,
      persistProgress,
      {
        chunkSize: AUTOMATION_RUN_LINK_CHUNK_SIZE,
        transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, automationRunLinksImport);
    await persistProgress(
      "automationRunLinks",
      formatSummaryStatus(automationRunLinksImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_links");
    logMessage(context, "Processing automation run test fields");
    await persistProgress(
      "automationRunTestFields",
      "Processing automation run test fields"
    );
    const automationRunTestFieldsImport = await importAutomationRunTestFields(
      prisma,
      normalizedConfiguration,
      datasetRowsByName,
      projectImport.projectIdMap,
      automationRunImport.testRunIdMap,
      automationRunTestCaseMap,
      automationRunJunitResultMap,
      context,
      persistProgress,
      {
        chunkSize: AUTOMATION_RUN_TEST_FIELD_CHUNK_SIZE,
        transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, automationRunTestFieldsImport);
    await persistProgress(
      "automationRunTestFields",
      formatSummaryStatus(automationRunTestFieldsImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_test_fields");
    logMessage(context, "Processing automation run tags");
    await persistProgress(
      "automationRunTags",
      "Processing automation run tags"
    );
    if (datasetRowsByName.get("automation_run_tags")?.length === 0) {
      datasetRowsByName.set(
        "automation_run_tags",
        await loadDatasetFromStaging("automation_run_tags")
      );
    }
    const automationRunTagsImport = await importAutomationRunTags(
      prisma,
      normalizedConfiguration,
      datasetRowsByName,
      automationRunImport.testRunIdMap,
      context,
      persistProgress,
      {
        chunkSize: AUTOMATION_RUN_TAG_CHUNK_SIZE,
        transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, automationRunTagsImport);
    await persistProgress(
      "automationRunTags",
      formatSummaryStatus(automationRunTagsImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_tags");
    logMessage(context, "Processing session values imports");
    await persistProgress("sessionValues", "Processing session values imports");
    if (datasetRowsByName.get("session_values")?.length === 0) {
      datasetRowsByName.set(
        "session_values",
        await loadDatasetFromStaging("session_values")
      );
    }
    const sessionValuesImport = await withTransaction(
      (tx) => importSessionValues(
        tx,
        datasetRowsByName,
        sessionImport.sessionIdMap,
        testmoFieldValueMap,
        normalizedConfiguration,
        caseImport.caseFieldMap,
        caseImport.caseFieldMetadataById,
        importJob,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, sessionValuesImport.summary);
    await persistProgress(
      "sessionValues",
      formatSummaryStatus(sessionValuesImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "session_values");
    logMessage(context, "Processing test run imports");
    await persistProgress("testRuns", "Processing test run imports");
    if (datasetRowsByName.get("runs")?.length === 0) {
      datasetRowsByName.set("runs", await loadDatasetFromStaging("runs"));
    }
    const testRunImport = await withTransaction(
      (tx) => importTestRuns(
        tx,
        datasetRowsByName,
        projectImport.projectIdMap,
        repositoryImport.canonicalRepoIdByProject,
        configurationIdMap,
        milestoneImport.milestoneIdMap,
        workflowIdMap,
        userIdMap,
        importJob,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, testRunImport.summary);
    await persistProgress(
      "testRuns",
      formatSummaryStatus(testRunImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "runs");
    logMessage(context, "Processing run links");
    await persistProgress("runLinks", "Processing run links");
    if (datasetRowsByName.get("run_links")?.length === 0) {
      datasetRowsByName.set(
        "run_links",
        await loadDatasetFromStaging("run_links")
      );
    }
    const runLinksImport = await withTransaction(
      (tx) => importRunLinks(
        tx,
        normalizedConfiguration,
        datasetRowsByName,
        testRunImport.testRunIdMap,
        context
      )
    );
    recordEntitySummary(context, runLinksImport);
    await persistProgress("runLinks", formatSummaryStatus(runLinksImport));
    releaseDatasetRows(datasetRowsByName, "run_links");
    logMessage(context, "Processing test run case imports");
    await persistProgress("testRunCases", "Processing test run case imports");
    if (datasetRowsByName.get("run_tests")?.length === 0) {
      datasetRowsByName.set(
        "run_tests",
        await loadDatasetFromStaging("run_tests")
      );
    }
    const testRunCaseImport = await importTestRunCases(
      datasetRowsByName,
      testRunImport.testRunIdMap,
      caseImport.caseIdMap,
      caseImport.caseMetaMap,
      userIdMap,
      statusIdMap,
      context,
      persistProgress
    );
    recordEntitySummary(context, testRunCaseImport.summary);
    await persistProgress(
      "testRunCases",
      formatSummaryStatus(testRunCaseImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "run_tests");
    logMessage(context, "Processing run tag assignments");
    await persistProgress("runTags", "Processing run tag assignments");
    if (datasetRowsByName.get("run_tags")?.length === 0) {
      datasetRowsByName.set(
        "run_tags",
        await loadDatasetFromStaging("run_tags")
      );
    }
    const runTagsSummary = await withTransaction(
      (tx) => importRunTags(
        tx,
        normalizedConfiguration,
        datasetRowsByName,
        testRunImport.testRunIdMap
      )
    );
    recordEntitySummary(context, runTagsSummary);
    await persistProgress("runTags", formatSummaryStatus(runTagsSummary));
    releaseDatasetRows(datasetRowsByName, "run_tags");
    logMessage(context, "Processing test run result imports");
    await persistProgress(
      "testRunResults",
      "Processing test run result imports"
    );
    if (datasetRowsByName.get("run_results")?.length === 0) {
      datasetRowsByName.set(
        "run_results",
        await loadDatasetFromStaging("run_results")
      );
    }
    const mergedTestRunCaseIdMap = new Map(testRunCaseImport.testRunCaseIdMap);
    for (const [testmoId, testRunCaseId] of automationRunTestCaseMap) {
      mergedTestRunCaseIdMap.set(testmoId, testRunCaseId);
    }
    const testRunResultImport = await importTestRunResults(
      datasetRowsByName,
      testRunImport.testRunIdMap,
      mergedTestRunCaseIdMap,
      statusIdMap,
      userIdMap,
      resultFieldMap,
      importJob,
      context,
      persistProgress
    );
    recordEntitySummary(context, testRunResultImport.summary);
    await persistProgress(
      "testRunResults",
      formatSummaryStatus(testRunResultImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "run_results");
    logMessage(context, "Processing test run step results");
    await persistProgress(
      "testRunStepResults",
      "Processing test run step results"
    );
    const stepResultsSummary = await importTestRunStepResults(
      datasetRowsByName,
      testRunResultImport.testRunResultIdMap,
      mergedTestRunCaseIdMap,
      statusIdMap,
      caseImport.caseIdMap,
      importJob,
      context,
      persistProgress
    );
    recordEntitySummary(context, stepResultsSummary);
    await persistProgress(
      "testRunStepResults",
      formatSummaryStatus(stepResultsSummary)
    );
    logMessage(context, "Processing issue targets");
    await persistProgress("issueTargets", "Processing issue targets");
    const issueTargetsImport = await withTransaction(
      (tx) => importIssueTargets(
        tx,
        normalizedConfiguration,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, issueTargetsImport.summary);
    await persistProgress(
      "issueTargets",
      formatSummaryStatus(issueTargetsImport.summary)
    );
    logMessage(context, "Processing issues");
    await persistProgress("issues", "Processing issues");
    if (datasetRowsByName.get("issues")?.length === 0) {
      datasetRowsByName.set(
        "issues",
        await loadDatasetFromStaging("issues")
      );
    }
    const issuesImport = await withTransaction(
      (tx) => importIssues(
        tx,
        datasetRowsByName,
        issueTargetsImport.integrationIdMap,
        projectImport.projectIdMap,
        importJob.createdById,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, issuesImport.summary);
    await persistProgress("issues", formatSummaryStatus(issuesImport.summary));
    logMessage(context, "Creating project-integration connections");
    await persistProgress(
      "projectIntegrations",
      "Creating project-integration connections"
    );
    const projectIntegrationsSummary = await withTransaction(
      (tx) => createProjectIntegrations(
        tx,
        datasetRowsByName,
        projectImport.projectIdMap,
        issueTargetsImport.integrationIdMap,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, projectIntegrationsSummary);
    await persistProgress(
      "projectIntegrations",
      formatSummaryStatus(projectIntegrationsSummary)
    );
    releaseDatasetRows(datasetRowsByName, "issues");
    logMessage(
      context,
      "Skipping milestone issue relationships (schema limitation)"
    );
    await persistProgress(
      "milestoneIssues",
      "Skipped (schema does not support milestone-issue relationships)"
    );
    if (datasetRowsByName.get("milestone_issues")?.length === 0) {
      datasetRowsByName.set(
        "milestone_issues",
        await loadDatasetFromStaging("milestone_issues")
      );
    }
    const milestoneIssuesSummary = await withTransaction(
      (tx) => importMilestoneIssues(
        tx,
        datasetRowsByName,
        milestoneImport.milestoneIdMap,
        issuesImport.issueIdMap,
        context,
        persistProgress
      )
    );
    recordEntitySummary(context, milestoneIssuesSummary);
    await persistProgress(
      "milestoneIssues",
      formatSummaryStatus(milestoneIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "milestone_issues");
    logMessage(context, "Processing repository case issue relationships");
    await persistProgress(
      "repositoryCaseIssues",
      "Processing repository case issue relationships"
    );
    if (datasetRowsByName.get("repository_case_issues")?.length === 0) {
      datasetRowsByName.set(
        "repository_case_issues",
        await loadDatasetFromStaging("repository_case_issues")
      );
    }
    const repositoryCaseIssuesSummary = await importRepositoryCaseIssues(
      prisma,
      datasetRowsByName,
      caseImport.caseIdMap,
      issuesImport.issueIdMap,
      context,
      persistProgress,
      {
        chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
        transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, repositoryCaseIssuesSummary);
    await persistProgress(
      "repositoryCaseIssues",
      formatSummaryStatus(repositoryCaseIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "repository_case_issues");
    logMessage(context, "Processing test run issue relationships");
    await persistProgress(
      "runIssues",
      "Processing test run issue relationships"
    );
    if (datasetRowsByName.get("run_issues")?.length === 0) {
      datasetRowsByName.set(
        "run_issues",
        await loadDatasetFromStaging("run_issues")
      );
    }
    const runIssuesSummary = await importRunIssues(
      prisma,
      datasetRowsByName,
      testRunImport.testRunIdMap,
      issuesImport.issueIdMap,
      context,
      persistProgress,
      {
        chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
        transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, runIssuesSummary);
    await persistProgress("runIssues", formatSummaryStatus(runIssuesSummary));
    releaseDatasetRows(datasetRowsByName, "run_issues");
    logMessage(context, "Processing test run result issue relationships");
    await persistProgress(
      "runResultIssues",
      "Processing test run result issue relationships"
    );
    if (datasetRowsByName.get("run_result_issues")?.length === 0) {
      datasetRowsByName.set(
        "run_result_issues",
        await loadDatasetFromStaging("run_result_issues")
      );
    }
    const runResultIssuesSummary = await importRunResultIssues(
      prisma,
      datasetRowsByName,
      testRunResultImport.testRunResultIdMap,
      issuesImport.issueIdMap,
      context,
      persistProgress,
      {
        chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
        transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, runResultIssuesSummary);
    await persistProgress(
      "runResultIssues",
      formatSummaryStatus(runResultIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "run_result_issues");
    logMessage(context, "Processing session issue relationships");
    await persistProgress(
      "sessionIssues",
      "Processing session issue relationships"
    );
    if (datasetRowsByName.get("session_issues")?.length === 0) {
      datasetRowsByName.set(
        "session_issues",
        await loadDatasetFromStaging("session_issues")
      );
    }
    const sessionIssuesSummary = await importSessionIssues(
      prisma,
      datasetRowsByName,
      sessionImport.sessionIdMap,
      issuesImport.issueIdMap,
      context,
      persistProgress,
      {
        chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
        transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, sessionIssuesSummary);
    await persistProgress(
      "sessionIssues",
      formatSummaryStatus(sessionIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "session_issues");
    logMessage(context, "Processing session result issue relationships");
    await persistProgress(
      "sessionResultIssues",
      "Processing session result issue relationships"
    );
    if (datasetRowsByName.get("session_result_issues")?.length === 0) {
      datasetRowsByName.set(
        "session_result_issues",
        await loadDatasetFromStaging("session_result_issues")
      );
    }
    const sessionResultIssuesSummary = await importSessionResultIssues(
      prisma,
      datasetRowsByName,
      sessionResultsImport.sessionResultIdMap,
      issuesImport.issueIdMap,
      context,
      persistProgress,
      {
        chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
        transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS
      }
    );
    recordEntitySummary(context, sessionResultIssuesSummary);
    await persistProgress(
      "sessionResultIssues",
      formatSummaryStatus(sessionResultIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "session_result_issues");
    logMessage(context, "Finalizing import configuration");
    await persistProgress(null, "Finalizing import configuration");
    const serializedConfiguration = serializeMappingConfiguration(
      normalizedConfiguration
    );
    const totalTimeMs = Date.now() - context.startTime;
    const totalTimeSeconds = Math.floor(totalTimeMs / 1e3);
    const minutes = Math.floor(totalTimeSeconds / 60);
    const seconds = totalTimeSeconds % 60;
    const totalTimeFormatted = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    logMessage(context, "Import completed successfully.", {
      processedEntities: context.processedCount,
      totalTime: totalTimeFormatted,
      totalTimeMs
    });
    await persistProgress(null, "Import completed successfully.");
    const updatedJob = await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        phase: null,
        statusMessage: "Import completed successfully.",
        completedAt: /* @__PURE__ */ new Date(),
        processedCount: context.processedCount,
        totalCount: context.processedCount,
        errorCount: 0,
        skippedCount: 0,
        currentEntity: null,
        estimatedTimeRemaining: null,
        processingRate: null,
        durationMs: totalTimeMs,
        activityLog: toInputJsonValue(context.activityLog),
        entityProgress: toInputJsonValue(context.entityProgress),
        configuration: toInputJsonValue(serializedConfiguration)
      }
    });
    const elasticsearchReindexQueue = getElasticsearchReindexQueue();
    if (elasticsearchReindexQueue) {
      try {
        logMessage(
          context,
          "Queueing Elasticsearch reindex after successful import"
        );
        const reindexJobData = {
          entityType: "all",
          userId: importJob.createdById
        };
        await elasticsearchReindexQueue.add(
          `reindex-after-import-${jobId}`,
          reindexJobData
        );
        console.log(
          `Queued Elasticsearch reindex job after import ${jobId} completion`
        );
      } catch (reindexError) {
        console.error(
          `Failed to queue Elasticsearch reindex after import ${jobId}:`,
          reindexError
        );
        logMessage(
          context,
          "Warning: Failed to queue Elasticsearch reindex. Search results may not include imported data until manual reindex is performed.",
          {
            error: reindexError instanceof Error ? reindexError.message : String(reindexError)
          }
        );
      }
    } else {
      console.warn(
        `Elasticsearch reindex queue not available after import ${jobId}. Search indexes will need to be updated manually.`
      );
    }
    return { status: updatedJob.status };
  } catch (error) {
    console.error(`Testmo import job ${jobId} failed during import`, error);
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error)
    };
    logMessage(context, "Import failed", errorDetails);
    const serializedConfiguration = serializeMappingConfiguration(
      normalizedConfiguration
    );
    await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        phase: null,
        statusMessage: "Import failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: /* @__PURE__ */ new Date(),
        currentEntity,
        processedCount: context.processedCount,
        totalCount: context.processedCount,
        activityLog: toInputJsonValue(context.activityLog),
        entityProgress: toInputJsonValue(context.entityProgress),
        configuration: toInputJsonValue(serializedConfiguration)
      }
    });
    throw error;
  }
}
async function processor(job) {
  const { jobId, mode = "analyze" } = job.data;
  if (!jobId) {
    throw new Error("Job id is required");
  }
  const importJob = await prisma.testmoImportJob.findUnique({
    where: { id: jobId }
  });
  if (!importJob) {
    throw new Error(`Testmo import job ${jobId} not found`);
  }
  if (FINAL_STATUSES.has(importJob.status)) {
    return { status: importJob.status };
  }
  if (mode === "import") {
    return processImportMode(importJob, jobId);
  }
  if (mode !== "analyze") {
    throw new Error(`Unsupported Testmo import job mode: ${mode}`);
  }
  if (!bucketName && !importJob.storageBucket) {
    throw new Error("AWS bucket is not configured");
  }
  const resolvedBucket = importJob.storageBucket || bucketName;
  if (!importJob.storageKey) {
    throw new Error("Storage key missing on import job");
  }
  if (importJob.cancelRequested) {
    await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "CANCELED",
        statusMessage: "Import was canceled before it started",
        canceledAt: /* @__PURE__ */ new Date(),
        phase: null
      }
    });
    return { status: "CANCELED" };
  }
  await prisma.testmoImportDataset.deleteMany({ where: { jobId } });
  await prisma.testmoImportJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      phase: "ANALYZING",
      statusMessage: "Opening and scanning export file...",
      startedAt: /* @__PURE__ */ new Date(),
      processedDatasets: 0,
      processedRows: BigInt(0)
    }
  });
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const { createWriteStream, createReadStream: createReadStream2, unlink } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const { promisify } = await import("util");
  const unlinkAsync = promisify(unlink);
  const tempFilePath = join(tmpdir(), `testmo-import-${jobId}.json`);
  console.log(
    `[Worker] Downloading file to temporary location: ${tempFilePath}`
  );
  await prisma.testmoImportJob.update({
    where: { id: jobId },
    data: {
      statusMessage: "Preparing data..."
    }
  });
  const getObjectResponse = await s3Client.send(
    new import_client_s3.GetObjectCommand({
      Bucket: resolvedBucket,
      Key: importJob.storageKey
    })
  );
  const s3Stream = getObjectResponse.Body;
  if (!s3Stream) {
    throw new Error("Failed to open uploaded file for download");
  }
  const fileSizeBigInt = getObjectResponse.ContentLength ?? importJob.originalFileSize;
  const fileSize = fileSizeBigInt ? Number(fileSizeBigInt) : void 0;
  console.log(
    `[Worker] File size: ${fileSize ? `${fileSize} bytes (${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB)` : "unknown"}`
  );
  const tempFileStream = createWriteStream(tempFilePath);
  let bodyStream;
  try {
    console.log(`[Worker] Streaming file from S3 to disk...`);
    await pipeline(s3Stream, tempFileStream);
    console.log(`[Worker] Download complete. File saved to ${tempFilePath}`);
    await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        statusMessage: "Download complete. Starting analysis..."
      }
    });
    bodyStream = createReadStream2(tempFilePath);
    if (fileSize) {
      bodyStream.__fileSize = fileSize;
    }
    bodyStream.on("close", async () => {
      try {
        await unlinkAsync(tempFilePath);
        console.log(`[Worker] Cleaned up temporary file: ${tempFilePath}`);
      } catch (error) {
        console.error(`[Worker] Failed to clean up temporary file:`, error);
      }
    });
  } catch (error) {
    try {
      await unlinkAsync(tempFilePath);
      console.log(
        `[Worker] Cleaned up temporary file after error: ${tempFilePath}`
      );
    } catch (cleanupError) {
      console.error(
        `[Worker] Failed to clean up temporary file after error:`,
        cleanupError
      );
    }
    throw error;
  }
  let processedDatasets = 0;
  let processedRows = BigInt(0);
  let cancelRequested = false;
  const handleProgress = async (bytesRead, totalBytes, percentage, estimatedTimeRemaining) => {
    if (cancelRequested) {
      return;
    }
    let etaDisplay = "";
    if (estimatedTimeRemaining) {
      if (estimatedTimeRemaining < 60) {
        etaDisplay = ` - ETA: ${estimatedTimeRemaining}s`;
      } else if (estimatedTimeRemaining < 3600) {
        const minutes = Math.ceil(estimatedTimeRemaining / 60);
        etaDisplay = ` - ETA: ${minutes}m`;
      } else {
        const hours = Math.floor(estimatedTimeRemaining / 3600);
        const minutes = Math.ceil(estimatedTimeRemaining % 3600 / 60);
        etaDisplay = ` - ETA: ${hours}h ${minutes}m`;
      }
    }
    console.log(
      `[Worker] Progress update: ${percentage}% (${bytesRead}/${totalBytes} bytes)${etaDisplay}`
    );
    await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        statusMessage: `Scanning file... ${percentage}% complete`,
        estimatedTimeRemaining: estimatedTimeRemaining?.toString() ?? null
      }
    });
  };
  const handleDatasetComplete = async (dataset) => {
    if (cancelRequested) {
      return;
    }
    processedDatasets += 1;
    processedRows += BigInt(dataset.rowCount);
    const schemaValue = dataset.schema !== void 0 && dataset.schema !== null ? JSON.parse(JSON.stringify(dataset.schema)) : import_client5.Prisma.JsonNull;
    const sampleRowsValue = dataset.sampleRows.length > 0 ? JSON.parse(
      JSON.stringify(dataset.sampleRows)
    ) : import_client5.Prisma.JsonNull;
    const allRowsValue = dataset.allRows && dataset.allRows.length > 0 ? JSON.parse(JSON.stringify(dataset.allRows)) : import_client5.Prisma.JsonNull;
    await prisma.testmoImportDataset.create({
      data: {
        jobId,
        name: dataset.name,
        rowCount: dataset.rowCount,
        sampleRowCount: dataset.sampleRows.length,
        truncated: dataset.truncated,
        schema: schemaValue,
        sampleRows: sampleRowsValue,
        allRows: allRowsValue
      }
    });
    const updatedJob = await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        processedDatasets,
        processedRows,
        statusMessage: `Found ${dataset.name} (${dataset.rowCount.toLocaleString()} rows)`
      },
      select: {
        cancelRequested: true
      }
    });
    cancelRequested = updatedJob.cancelRequested;
  };
  try {
    const summary = await analyzeTestmoExport(bodyStream, jobId, prisma, {
      onDatasetComplete: handleDatasetComplete,
      onProgress: handleProgress,
      shouldAbort: () => cancelRequested
    });
    if (cancelRequested) {
      await prisma.testmoImportJob.update({
        where: { id: jobId },
        data: {
          status: "CANCELED",
          statusMessage: "Import was canceled",
          canceledAt: /* @__PURE__ */ new Date(),
          phase: null
        }
      });
      return { status: "CANCELED" };
    }
    const analysisPayload = {
      meta: {
        totalDatasets: summary.meta.totalDatasets,
        totalRows: summary.meta.totalRows,
        durationMs: summary.meta.durationMs,
        startedAt: summary.meta.startedAt.toISOString(),
        completedAt: summary.meta.completedAt.toISOString(),
        fileSizeBytes: Number(
          importJob.originalFileSize ?? summary.meta.fileSizeBytes ?? 0
        ) || 0
      }
    };
    await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "READY",
        phase: "CONFIGURING",
        statusMessage: "Analysis complete. Configure mapping to continue.",
        totalDatasets: summary.meta.totalDatasets,
        totalRows: BigInt(summary.meta.totalRows),
        processedDatasets,
        processedRows,
        durationMs: summary.meta.durationMs,
        analysisGeneratedAt: /* @__PURE__ */ new Date(),
        configuration: import_client5.Prisma.JsonNull,
        options: import_client5.Prisma.JsonNull,
        analysis: analysisPayload,
        processedCount: 0,
        errorCount: 0,
        skippedCount: 0,
        totalCount: 0,
        currentEntity: null,
        estimatedTimeRemaining: null,
        processingRate: null,
        activityLog: import_client5.Prisma.JsonNull,
        entityProgress: import_client5.Prisma.JsonNull
      }
    });
    if (processedDatasets === 0 && summary.meta.totalDatasets === 0) {
      await prisma.testmoImportJob.update({
        where: { id: jobId },
        data: {
          statusMessage: "Analysis complete (no datasets found)"
        }
      });
    }
    return { status: "READY" };
  } catch (error) {
    if (cancelRequested || error instanceof Error && error.name === "AbortError") {
      await prisma.testmoImportJob.update({
        where: { id: jobId },
        data: {
          status: "CANCELED",
          statusMessage: "Import was canceled",
          canceledAt: /* @__PURE__ */ new Date(),
          phase: null
        }
      });
      return { status: "CANCELED" };
    }
    console.error(`Testmo import job ${jobId} failed`, error);
    await prisma.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        statusMessage: "Import failed",
        error: error instanceof Error ? error.message : String(error),
        phase: null
      }
    });
    throw error;
  }
}
async function startWorker() {
  if (isMultiTenantMode()) {
    console.log("Testmo import worker starting in MULTI-TENANT mode");
    console.warn("WARNING: Testmo import currently only supports single-tenant mode. Multi-tenant support requires refactoring.");
  } else {
    console.log("Testmo import worker starting in SINGLE-TENANT mode");
  }
  if (!valkey_default) {
    console.warn(
      "Valkey connection not available. Testmo import worker cannot start."
    );
    process.exit(1);
  }
  const worker = new import_bullmq2.Worker(TESTMO_IMPORT_QUEUE_NAME, processor, {
    connection: valkey_default,
    concurrency: 1
  });
  worker.on("completed", (job) => {
    console.log(
      `Testmo import job ${job.id} completed successfully (${job.name}).`
    );
  });
  worker.on("failed", (job, err) => {
    console.error(`Testmo import job ${job?.id} failed with error:`, err);
  });
  worker.on("error", (err) => {
    console.error("Testmo import worker encountered an error:", err);
  });
  console.log("Testmo import worker started and listening for jobs...");
  const shutdown = async () => {
    console.log("Shutting down Testmo import worker...");
    await worker.close();
    await prisma.$disconnect();
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    console.log("Testmo import worker shut down gracefully.");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
if (typeof import_meta !== "undefined" && import_meta.url === (0, import_node_url2.pathToFileURL)(process.argv[1]).href || (typeof import_meta === "undefined" || import_meta.url === void 0)) {
  startWorker().catch((err) => {
    console.error("Failed to start Testmo import worker:", err);
    process.exit(1);
  });
}
//# sourceMappingURL=testmoImportWorker.js.map
