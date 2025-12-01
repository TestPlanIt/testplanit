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

// lib/queues.ts
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
var NOTIFICATION_QUEUE_NAME = "notifications";
var EMAIL_QUEUE_NAME = "emails";

// lib/queues.ts
var _forecastQueue = null;
var _notificationQueue = null;
var _emailQueue = null;
function getForecastQueue() {
  if (_forecastQueue) return _forecastQueue;
  if (!valkey_default) {
    console.warn(`Valkey connection not available, Queue "${FORECAST_QUEUE_NAME}" not initialized.`);
    return null;
  }
  _forecastQueue = new import_bullmq.Queue(FORECAST_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5e3
      },
      removeOnComplete: {
        age: 3600 * 24 * 7,
        count: 1e3
      },
      removeOnFail: {
        age: 3600 * 24 * 14
      }
    }
  });
  console.log(`Queue "${FORECAST_QUEUE_NAME}" initialized.`);
  _forecastQueue.on("error", (error) => {
    console.error(`Queue ${FORECAST_QUEUE_NAME} error:`, error);
  });
  return _forecastQueue;
}
function getNotificationQueue() {
  if (_notificationQueue) return _notificationQueue;
  if (!valkey_default) {
    console.warn(`Valkey connection not available, Queue "${NOTIFICATION_QUEUE_NAME}" not initialized.`);
    return null;
  }
  _notificationQueue = new import_bullmq.Queue(NOTIFICATION_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5e3
      },
      removeOnComplete: {
        age: 3600 * 24 * 7,
        count: 1e3
      },
      removeOnFail: {
        age: 3600 * 24 * 14
      }
    }
  });
  console.log(`Queue "${NOTIFICATION_QUEUE_NAME}" initialized.`);
  _notificationQueue.on("error", (error) => {
    console.error(`Queue ${NOTIFICATION_QUEUE_NAME} error:`, error);
  });
  return _notificationQueue;
}
function getEmailQueue() {
  if (_emailQueue) return _emailQueue;
  if (!valkey_default) {
    console.warn(`Valkey connection not available, Queue "${EMAIL_QUEUE_NAME}" not initialized.`);
    return null;
  }
  _emailQueue = new import_bullmq.Queue(EMAIL_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1e4
      },
      removeOnComplete: {
        age: 3600 * 24 * 30,
        count: 5e3
      },
      removeOnFail: {
        age: 3600 * 24 * 30
      }
    }
  });
  console.log(`Queue "${EMAIL_QUEUE_NAME}" initialized.`);
  _emailQueue.on("error", (error) => {
    console.error(`Queue ${EMAIL_QUEUE_NAME} error:`, error);
  });
  return _emailQueue;
}

// workers/forecastWorker.ts
var import_bullmq2 = require("bullmq");

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
    const worker2 = new import_bullmq2.Worker(FORECAST_QUEUE_NAME, processor, {
      connection: valkey_default,
      concurrency: 5,
      limiter: {
        max: 100,
        duration: 1e3
      }
    });
    worker2.on("completed", (job, result) => {
      console.info(
        `Worker: Job ${job.id} (${job.name}) completed successfully. Result:`,
        result
      );
    });
    worker2.on("failed", (job, err) => {
      console.error(
        `Worker: Job ${job?.id} (${job?.name}) failed with error:`,
        err
      );
    });
    worker2.on("error", (err) => {
      console.error("Worker encountered an error:", err);
    });
    console.log("Forecast worker started and listening for jobs...");
    const shutdown = async () => {
      console.log("Shutting down forecast worker...");
      await worker2.close();
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

// workers/notificationWorker.ts
var import_bullmq3 = require("bullmq");
var import_client2 = require("@prisma/client");
var import_node_url2 = require("node:url");
var import_meta2 = {};
var prisma2 = new import_client2.PrismaClient();
var JOB_CREATE_NOTIFICATION = "create-notification";
var JOB_PROCESS_USER_NOTIFICATIONS = "process-user-notifications";
var JOB_SEND_DAILY_DIGEST = "send-daily-digest";
var processor2 = async (job) => {
  console.log(`Processing notification job ${job.id} of type ${job.name}`);
  switch (job.name) {
    case JOB_CREATE_NOTIFICATION:
      const createData = job.data;
      try {
        const userPreferences = await prisma2.userPreferences.findUnique({
          where: { userId: createData.userId }
        });
        const globalSettings = await prisma2.appConfig.findUnique({
          where: { key: "notificationSettings" }
        });
        let notificationMode = userPreferences?.notificationMode || "USE_GLOBAL";
        if (notificationMode === "USE_GLOBAL") {
          const settingsValue = globalSettings?.value;
          notificationMode = settingsValue?.defaultMode || "IN_APP";
        }
        if (notificationMode === "NONE") {
          console.log(
            `Skipping notification for user ${createData.userId} - notifications disabled`
          );
          return;
        }
        const notification = await prisma2.notification.create({
          data: {
            userId: createData.userId,
            type: createData.type,
            title: createData.title,
            message: createData.message,
            relatedEntityId: createData.relatedEntityId,
            relatedEntityType: createData.relatedEntityType,
            data: createData.data
          }
        });
        if (notificationMode === "IN_APP_EMAIL_IMMEDIATE") {
          await getEmailQueue()?.add("send-notification-email", {
            notificationId: notification.id,
            userId: createData.userId,
            immediate: true
          });
        }
        console.log(
          `Created notification ${notification.id} for user ${createData.userId} with mode ${notificationMode}`
        );
      } catch (error) {
        console.error(`Failed to create notification:`, error);
        throw error;
      }
      break;
    case JOB_PROCESS_USER_NOTIFICATIONS:
      const processData = job.data;
      try {
        const notifications = await prisma2.notification.findMany({
          where: {
            userId: processData.userId,
            isRead: false,
            isDeleted: false
          },
          orderBy: { createdAt: "desc" }
        });
        console.log(
          `Processing ${notifications.length} notifications for user ${processData.userId}`
        );
      } catch (error) {
        console.error(`Failed to process user notifications:`, error);
        throw error;
      }
      break;
    case JOB_SEND_DAILY_DIGEST:
      try {
        const globalSettings = await prisma2.appConfig.findUnique({
          where: { key: "notificationSettings" }
        });
        const settingsValue = globalSettings?.value;
        const globalDefaultMode = settingsValue?.defaultMode || "IN_APP";
        const users = await prisma2.userPreferences.findMany({
          where: {
            OR: [
              { notificationMode: "IN_APP_EMAIL_DAILY" },
              {
                notificationMode: "USE_GLOBAL",
                ...globalDefaultMode === "IN_APP_EMAIL_DAILY" ? {} : { id: "none" }
                // Only include if global is daily
              }
            ]
          },
          include: {
            user: true
          }
        });
        for (const userPref of users) {
          const yesterday = /* @__PURE__ */ new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const notifications = await prisma2.notification.findMany({
            where: {
              userId: userPref.userId,
              isRead: false,
              isDeleted: false,
              createdAt: { gte: yesterday }
            },
            orderBy: { createdAt: "desc" }
          });
          if (notifications.length > 0) {
            await getEmailQueue()?.add("send-digest-email", {
              userId: userPref.userId,
              notifications: notifications.map((n) => ({
                id: n.id,
                title: n.title,
                message: n.message,
                createdAt: n.createdAt
              }))
            });
          }
        }
        console.log(`Processed daily digest for ${users.length} users`);
      } catch (error) {
        console.error(`Failed to send daily digest:`, error);
        throw error;
      }
      break;
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
};
var worker = null;
var startWorker2 = async () => {
  if (valkey_default) {
    worker = new import_bullmq3.Worker(NOTIFICATION_QUEUE_NAME, processor2, {
      connection: valkey_default,
      concurrency: 5
    });
    worker.on("completed", (job) => {
      console.log(`Job ${job.id} completed successfully.`);
    });
    worker.on("failed", (job, err) => {
      console.error(`Job ${job?.id} failed:`, err);
    });
    worker.on("error", (err) => {
      console.error("Worker error:", err);
    });
    console.log(
      `Notification worker started for queue "${NOTIFICATION_QUEUE_NAME}".`
    );
  } else {
    console.warn(
      "Valkey connection not available. Notification worker not started."
    );
  }
  process.on("SIGINT", async () => {
    console.log("Shutting down notification worker...");
    if (worker) {
      await worker.close();
    }
    await prisma2.$disconnect();
    process.exit(0);
  });
};
if (typeof import_meta2 !== "undefined" && import_meta2.url === (0, import_node_url2.pathToFileURL)(process.argv[1]).href || (typeof import_meta2 === "undefined" || import_meta2.url === void 0)) {
  console.log("Notification worker running...");
  startWorker2().catch((err) => {
    console.error("Failed to start notification worker:", err);
    process.exit(1);
  });
}

// scheduler.ts
var CRON_SCHEDULE_DAILY_3AM = "0 3 * * *";
var CRON_SCHEDULE_DAILY_8AM = "0 8 * * *";
async function scheduleJobs() {
  console.log("Attempting to schedule jobs...");
  const forecastQueue = getForecastQueue();
  const notificationQueue = getNotificationQueue();
  if (!forecastQueue || !notificationQueue) {
    console.error("Required queues are not initialized. Cannot schedule jobs.");
    process.exit(1);
  }
  try {
    const repeatableJobs = await forecastQueue.getRepeatableJobs();
    let removedCount = 0;
    for (const job of repeatableJobs) {
      if (job.name === JOB_UPDATE_ALL_CASES) {
        console.log(
          `Removing existing repeatable job "${job.name}" with key: ${job.key}`
        );
        await forecastQueue.removeRepeatableByKey(job.key);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      console.log(`Removed ${removedCount} old repeatable forecast jobs.`);
    }
    await forecastQueue.add(
      JOB_UPDATE_ALL_CASES,
      // Job name from worker
      {},
      // No specific data needed
      {
        repeat: {
          // BullMQ v3+ uses pattern instead of cron
          // For older versions use: cron: CRON_SCHEDULE_DAILY_3AM
          pattern: CRON_SCHEDULE_DAILY_3AM
          // tz: 'UTC', // Example: Explicitly set timezone if needed
        },
        jobId: JOB_UPDATE_ALL_CASES
        // Use the job name as a predictable ID
      }
    );
    console.log(
      `Successfully scheduled repeatable job "${JOB_UPDATE_ALL_CASES}" with pattern "${CRON_SCHEDULE_DAILY_3AM}" on queue "${FORECAST_QUEUE_NAME}".`
    );
    const notificationRepeatableJobs = await notificationQueue.getRepeatableJobs();
    let removedNotificationCount = 0;
    for (const job of notificationRepeatableJobs) {
      if (job.name === JOB_SEND_DAILY_DIGEST) {
        console.log(
          `Removing existing repeatable job "${job.name}" with key: ${job.key}`
        );
        await notificationQueue.removeRepeatableByKey(job.key);
        removedNotificationCount++;
      }
    }
    if (removedNotificationCount > 0) {
      console.log(
        `Removed ${removedNotificationCount} old repeatable notification jobs.`
      );
    }
    await notificationQueue.add(
      JOB_SEND_DAILY_DIGEST,
      {},
      {
        repeat: {
          pattern: CRON_SCHEDULE_DAILY_8AM
        },
        jobId: JOB_SEND_DAILY_DIGEST
      }
    );
    console.log(
      `Successfully scheduled repeatable job "${JOB_SEND_DAILY_DIGEST}" with pattern "${CRON_SCHEDULE_DAILY_8AM}" on queue "${NOTIFICATION_QUEUE_NAME}".`
    );
  } catch (error) {
    console.error("Error scheduling jobs:", error);
    process.exit(1);
  }
}
scheduleJobs().then(() => {
  console.log("Scheduling script finished successfully.");
  process.exit(0);
}).catch((err) => {
  console.error("Scheduling script failed unexpectedly:", err);
  process.exit(1);
});
//# sourceMappingURL=scheduler.js.map
