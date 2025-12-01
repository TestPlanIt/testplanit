"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// workers/forecastWorker.ts
var forecastWorker_exports = {};
__export(forecastWorker_exports, {
  JOB_UPDATE_ALL_CASES: () => JOB_UPDATE_ALL_CASES,
  JOB_UPDATE_SINGLE_CASE: () => JOB_UPDATE_SINGLE_CASE
});
module.exports = __toCommonJS(forecastWorker_exports);
var import_bullmq = require("bullmq");

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

// lib/queueNames.ts
var FORECAST_QUEUE_NAME = "forecast-updates";

// lib/prismaBase.ts
var import_client = require("@prisma/client");
var prismaClient;
if (process.env.NODE_ENV === "production") {
  prismaClient = new import_client.PrismaClient({ errorFormat: "pretty" });
} else {
  if (!global.prismaBase) {
    global.prismaBase = new import_client.PrismaClient({ errorFormat: "colorless" });
  }
  prismaClient = global.prismaBase;
}
var prisma = prismaClient;

// services/forecastService.ts
async function updateRepositoryCaseForecast(repositoryCaseId, options = {}) {
  if (process.env.DEBUG_FORECAST) {
    console.log(
      `Calculating group forecast for RepositoryCase ID: ${repositoryCaseId}`
    );
  }
  try {
    const caseAndLinks = await prisma.repositoryCases.findUnique({
      where: { id: repositoryCaseId },
      select: {
        id: true,
        source: true,
        linksFrom: {
          where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
          select: { caseBId: true }
        },
        linksTo: {
          where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
          select: { caseAId: true }
        }
      }
    });
    if (!caseAndLinks) return { updatedCaseIds: [], affectedTestRunIds: [] };
    const linkedIds = [
      caseAndLinks.id,
      ...caseAndLinks.linksFrom.map((l) => l.caseBId),
      ...caseAndLinks.linksTo.map((l) => l.caseAId)
    ];
    const uniqueCaseIds = Array.from(new Set(linkedIds));
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] Group case IDs:", uniqueCaseIds);
    const allCases = await prisma.repositoryCases.findMany({
      where: { id: { in: uniqueCaseIds } },
      select: { id: true, source: true }
    });
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] allCases:", allCases);
    const manualCaseIds = allCases.filter((c) => c.source === "MANUAL").map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualCaseIds:", manualCaseIds);
    let manualResults = [];
    if (manualCaseIds.length) {
      const testRunCases = await prisma.testRunCases.findMany({
        where: { repositoryCaseId: { in: manualCaseIds } },
        select: { id: true }
      });
      const testRunCaseIds = testRunCases.map((trc) => trc.id);
      manualResults = testRunCaseIds.length ? await prisma.testRunResults.findMany({
        where: {
          testRunCaseId: { in: testRunCaseIds },
          isDeleted: false,
          elapsed: { gt: 0 }
        },
        select: { elapsed: true }
      }) : [];
    }
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualResults:", manualResults);
    const manualDurations = manualResults.map((r) => r.elapsed).filter((v) => v != null);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualDurations:", manualDurations);
    const junitCaseIds = allCases.filter((c) => c.source === "JUNIT").map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitCaseIds:", junitCaseIds);
    const junitResults = junitCaseIds.length ? await prisma.jUnitTestResult.findMany({
      where: {
        repositoryCaseId: { in: junitCaseIds },
        time: { gt: 0 }
      },
      select: { time: true }
    }) : [];
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitResults:", junitResults);
    const junitDurations = junitResults.map((r) => r.time).filter((v) => v != null);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] junitDurations:", junitDurations);
    const avgManual = manualDurations.length > 0 ? Math.round(
      manualDurations.reduce((a, b) => a + b, 0) / manualDurations.length
    ) : null;
    const avgJunit = junitDurations.length > 0 ? parseFloat(
      (junitDurations.reduce((a, b) => a + b, 0) / junitDurations.length).toFixed(3)
    ) : null;
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] avgManual:", avgManual, "avgJunit:", avgJunit);
    for (const caseId of uniqueCaseIds) {
      await prisma.repositoryCases.update({
        where: { id: caseId },
        data: {
          forecastManual: avgManual,
          forecastAutomated: avgJunit
        }
      });
    }
    if (process.env.DEBUG_FORECAST) {
      console.log(
        `Updated forecastManual=${avgManual}, forecastAutomated=${avgJunit} for cases: [${uniqueCaseIds.join(", ")}]`
      );
    }
    const affectedTestRunCases = await prisma.testRunCases.findMany({
      where: {
        repositoryCaseId: { in: uniqueCaseIds }
      },
      select: {
        testRunId: true
      }
    });
    const uniqueAffectedTestRunIds = Array.from(
      new Set(affectedTestRunCases.map((trc) => trc.testRunId))
    );
    if (!options.skipTestRunUpdate && uniqueAffectedTestRunIds.length > 0) {
      for (const testRunId of uniqueAffectedTestRunIds) {
        await updateTestRunForecast(testRunId, {
          alreadyRefreshedCaseIds: new Set(uniqueCaseIds)
        });
      }
    }
    return {
      updatedCaseIds: uniqueCaseIds,
      affectedTestRunIds: options.collectAffectedTestRuns ? uniqueAffectedTestRunIds : []
    };
  } catch (error) {
    console.error(
      `Error updating group forecast for RepositoryCase ID ${repositoryCaseId}:`,
      error
    );
    throw error;
  }
}
async function updateTestRunForecast(testRunId, options = {}) {
  if (process.env.DEBUG_FORECAST) console.log(`Updating forecast for TestRun ID: ${testRunId}`);
  try {
    let testRunCasesWithDetails = await prisma.testRunCases.findMany({
      where: { testRunId },
      select: {
        repositoryCaseId: true,
        status: {
          select: {
            systemName: true
          }
        }
      }
    });
    if (testRunCasesWithDetails.length > 0) {
      const processedCaseIds = new Set(
        options.alreadyRefreshedCaseIds ? Array.from(options.alreadyRefreshedCaseIds) : []
      );
      const repositoryCaseIdsInRun = Array.from(
        new Set(testRunCasesWithDetails.map((trc) => trc.repositoryCaseId))
      );
      let refreshedAnyCase = false;
      for (const repositoryCaseId of repositoryCaseIdsInRun) {
        if (processedCaseIds.has(repositoryCaseId)) {
          continue;
        }
        const result = await updateRepositoryCaseForecast(
          repositoryCaseId,
          { skipTestRunUpdate: true }
        );
        if (result.updatedCaseIds.length > 0) {
          refreshedAnyCase = true;
          for (const refreshedId of result.updatedCaseIds) {
            processedCaseIds.add(refreshedId);
          }
        }
      }
      if (refreshedAnyCase) {
        testRunCasesWithDetails = await prisma.testRunCases.findMany({
          where: { testRunId },
          select: {
            repositoryCaseId: true,
            status: {
              select: {
                systemName: true
              }
            }
          }
        });
      }
    }
    const repositoryCaseIdsToForecast = testRunCasesWithDetails.filter(
      (trc) => trc.status === null || trc.status?.systemName === "UNTESTED"
    ).map((trc) => trc.repositoryCaseId);
    if (!repositoryCaseIdsToForecast.length) {
      await prisma.testRuns.update({
        where: { id: testRunId },
        data: {
          forecastManual: null,
          forecastAutomated: null
        }
      });
      if (process.env.DEBUG_FORECAST) {
        console.log(
          `Cleared forecasts for TestRun ID: ${testRunId} as no pending/untested cases were found`
        );
      }
      return;
    }
    const repositoryCases = await prisma.repositoryCases.findMany({
      where: { id: { in: repositoryCaseIdsToForecast } },
      select: { forecastManual: true, forecastAutomated: true }
    });
    let totalForecastManual = 0;
    let totalForecastAutomated = 0;
    let hasManual = false;
    let hasAutomated = false;
    for (const rc of repositoryCases) {
      if (rc.forecastManual !== null) {
        totalForecastManual += rc.forecastManual;
        hasManual = true;
      }
      if (rc.forecastAutomated !== null) {
        totalForecastAutomated += rc.forecastAutomated;
        hasAutomated = true;
      }
    }
    await prisma.testRuns.update({
      where: { id: testRunId },
      data: {
        forecastManual: hasManual ? totalForecastManual : null,
        forecastAutomated: hasAutomated ? parseFloat(totalForecastAutomated.toFixed(3)) : null
      }
    });
    if (process.env.DEBUG_FORECAST) {
      console.log(
        `Updated TestRun ID ${testRunId} with forecastManual=${totalForecastManual}, forecastAutomated=${totalForecastAutomated}`
      );
    }
  } catch (error) {
    console.error(
      `Error updating forecast for TestRun ID ${testRunId}:`,
      error
    );
    throw error;
  }
}
async function getUniqueCaseGroupIds() {
  if (process.env.DEBUG_FORECAST) console.log("Fetching unique case group representatives...");
  try {
    const BATCH_SIZE = 1e3;
    const processedCaseIds = /* @__PURE__ */ new Set();
    const uniqueRepresentatives = [];
    const allCaseIds = await prisma.repositoryCases.findMany({
      where: {
        isDeleted: false,
        isArchived: false
      },
      select: {
        id: true
      }
    });
    const totalCases = allCaseIds.length;
    if (process.env.DEBUG_FORECAST) console.log(`Processing ${totalCases} active cases in batches of ${BATCH_SIZE}...`);
    for (let i = 0; i < allCaseIds.length; i += BATCH_SIZE) {
      const batchIds = allCaseIds.slice(i, i + BATCH_SIZE).map((c) => c.id);
      const casesWithLinks = await prisma.repositoryCases.findMany({
        where: {
          id: { in: batchIds }
        },
        select: {
          id: true,
          linksFrom: {
            where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
            select: { caseBId: true }
          },
          linksTo: {
            where: { type: "SAME_TEST_DIFFERENT_SOURCE", isDeleted: false },
            select: { caseAId: true }
          }
        }
      });
      for (const caseData of casesWithLinks) {
        if (processedCaseIds.has(caseData.id)) {
          continue;
        }
        uniqueRepresentatives.push(caseData.id);
        const linkedIds = [
          caseData.id,
          ...caseData.linksFrom.map((l) => l.caseBId),
          ...caseData.linksTo.map((l) => l.caseAId)
        ];
        for (const linkedId of linkedIds) {
          processedCaseIds.add(linkedId);
        }
      }
      if (process.env.DEBUG_FORECAST) {
        console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalCases / BATCH_SIZE)}: ${uniqueRepresentatives.length} unique groups so far`);
      }
    }
    if (process.env.DEBUG_FORECAST) {
      console.log(
        `Found ${uniqueRepresentatives.length} unique case groups (from ${totalCases} total active cases)`
      );
    }
    return uniqueRepresentatives;
  } catch (error) {
    console.error("Error fetching unique case group IDs:", error);
    throw error;
  }
}

// workers/forecastWorker.ts
var import_node_url = require("node:url");
var import_meta = {};
var JOB_UPDATE_SINGLE_CASE = "update-single-case-forecast";
var JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";
var processor = async (job) => {
  console.log(`Processing job ${job.id} of type ${job.name}`);
  let successCount = 0;
  let failCount = 0;
  switch (job.name) {
    case JOB_UPDATE_SINGLE_CASE:
      const singleData = job.data;
      if (!singleData || typeof singleData.repositoryCaseId !== "number") {
        throw new Error(
          `Invalid data for job ${job.id}: repositoryCaseId missing or not a number.`
        );
      }
      try {
        await updateRepositoryCaseForecast(singleData.repositoryCaseId);
        successCount = 1;
        console.log(
          `Job ${job.id} completed: Updated forecast for case ${singleData.repositoryCaseId}`
        );
      } catch (error) {
        failCount = 1;
        console.error(
          `Job ${job.id} failed for case ${singleData.repositoryCaseId}`,
          error
        );
        throw error;
      }
      break;
    case JOB_UPDATE_ALL_CASES:
      console.log(`Job ${job.id}: Starting update for all active cases.`);
      successCount = 0;
      failCount = 0;
      const caseIds = await getUniqueCaseGroupIds();
      const affectedTestRunIds = /* @__PURE__ */ new Set();
      for (const caseId of caseIds) {
        try {
          const result = await updateRepositoryCaseForecast(caseId, {
            skipTestRunUpdate: true,
            collectAffectedTestRuns: true
          });
          for (const testRunId of result.affectedTestRunIds) {
            affectedTestRunIds.add(testRunId);
          }
          successCount++;
        } catch (error) {
          console.error(
            `Job ${job.id}: Failed to update forecast for case ${caseId}`,
            error
          );
          failCount++;
        }
      }
      console.log(
        `Job ${job.id}: Processed ${caseIds.length} unique case groups. Success: ${successCount}, Failed: ${failCount}`
      );
      console.log(
        `Job ${job.id}: Filtering ${affectedTestRunIds.size} affected test runs...`
      );
      const activeTestRuns = await prisma.testRuns.findMany({
        where: {
          id: { in: Array.from(affectedTestRunIds) },
          isCompleted: false
        },
        select: { id: true }
      });
      const activeTestRunIds = activeTestRuns.map((tr) => tr.id);
      const skippedCompletedCount = affectedTestRunIds.size - activeTestRunIds.length;
      console.log(
        `Job ${job.id}: Updating ${activeTestRunIds.length} active test runs (skipped ${skippedCompletedCount} completed)...`
      );
      let testRunSuccessCount = 0;
      let testRunFailCount = 0;
      for (const testRunId of activeTestRunIds) {
        try {
          await updateTestRunForecast(testRunId);
          testRunSuccessCount++;
        } catch (error) {
          console.error(
            `Job ${job.id}: Failed to update forecast for test run ${testRunId}`,
            error
          );
          testRunFailCount++;
        }
      }
      console.log(
        `Job ${job.id} completed: Updated ${testRunSuccessCount} test runs. Failed: ${testRunFailCount}. Skipped ${skippedCompletedCount} completed.`
      );
      if (failCount > 0 || testRunFailCount > 0) {
        console.warn(
          `Job ${job.id} finished with ${failCount} case failures and ${testRunFailCount} test run failures.`
        );
      }
      break;
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
  return { status: "completed", successCount, failCount };
};
async function startWorker() {
  if (valkey_default) {
    const worker = new import_bullmq.Worker(FORECAST_QUEUE_NAME, processor, {
      connection: valkey_default,
      concurrency: 5,
      limiter: {
        max: 100,
        duration: 1e3
      }
    });
    worker.on("completed", (job, result) => {
      console.info(
        `Worker: Job ${job.id} (${job.name}) completed successfully. Result:`,
        result
      );
    });
    worker.on("failed", (job, err) => {
      console.error(
        `Worker: Job ${job?.id} (${job?.name}) failed with error:`,
        err
      );
    });
    worker.on("error", (err) => {
      console.error("Worker encountered an error:", err);
    });
    console.log("Forecast worker started and listening for jobs...");
    const shutdown = async () => {
      console.log("Shutting down forecast worker...");
      await worker.close();
      console.log("Forecast worker shut down gracefully.");
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } else {
    console.warn(
      "Valkey connection not available. Forecast worker cannot start."
    );
    process.exit(1);
  }
}
if (typeof import_meta !== "undefined" && import_meta.url === (0, import_node_url.pathToFileURL)(process.argv[1]).href || typeof import_meta === "undefined" || import_meta.url === void 0) {
  startWorker().catch((err) => {
    console.error("Failed to start worker:", err);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JOB_UPDATE_ALL_CASES,
  JOB_UPDATE_SINGLE_CASE
});
//# sourceMappingURL=forecastWorker.js.map
