"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// lib/prismaBase.ts
var prismaBase_exports = {};
__export(prismaBase_exports, {
  prisma: () => prisma
});
var import_client, prismaClient, prisma;
var init_prismaBase = __esm({
  "lib/prismaBase.ts"() {
    "use strict";
    import_client = require("@prisma/client");
    if (process.env.NODE_ENV === "production") {
      prismaClient = new import_client.PrismaClient({ errorFormat: "pretty" });
    } else {
      if (!global.prismaBase) {
        global.prismaBase = new import_client.PrismaClient({ errorFormat: "colorless" });
      }
      prismaClient = global.prismaBase;
    }
    prisma = prismaClient;
  }
});

// env.js
var import_env_nextjs, import_v4, env;
var init_env = __esm({
  "env.js"() {
    "use strict";
    import_env_nextjs = require("@t3-oss/env-nextjs");
    import_v4 = require("zod/v4");
    env = (0, import_env_nextjs.createEnv)({
      /**
       * Specify your server-side environment variables schema here. This way you can ensure the app
       * isn't built with invalid env vars.
       */
      server: {
        DATABASE_URL: import_v4.z.string().refine(
          (str) => !str.includes("YOUR_MYSQL_URL_HERE"),
          "You forgot to change the default URL"
        ),
        NODE_ENV: import_v4.z.enum(["development", "test", "production"]).prefault("development"),
        NEXTAUTH_SECRET: process.env.NODE_ENV === "production" ? import_v4.z.string() : import_v4.z.string().optional(),
        NEXTAUTH_URL: import_v4.z.preprocess(
          // This makes Vercel deployments not fail if you don't set NEXTAUTH_URL
          // Since NextAuth.js automatically uses the VERCEL_URL if present.
          (str) => process.env.VERCEL_URL ?? str,
          // VERCEL_URL doesn't include `https` so it cant be validated as a URL
          process.env.VERCEL ? import_v4.z.string() : import_v4.z.url()
        ),
        ELASTICSEARCH_NODE: import_v4.z.url().optional()
      },
      /**
       * Specify your client-side environment variables schema here. This way you can ensure the app
       * isn't built with invalid env vars. To expose them to the client, prefix them with
       * `NEXT_PUBLIC_`.
       */
      client: {
        // NEXT_PUBLIC_CLIENTVAR: z.string(),
      },
      /**
       * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
       * middlewares) or client-side so we need to destruct manually.
       */
      runtimeEnv: {
        DATABASE_URL: process.env.DATABASE_URL,
        NODE_ENV: process.env.NODE_ENV,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        ELASTICSEARCH_NODE: process.env.ELASTICSEARCH_NODE
      },
      /**
       * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
       * useful for Docker builds.
       */
      skipValidation: !!process.env.SKIP_ENV_VALIDATION,
      /**
       * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
       * `SOME_VAR=''` will throw an error.
       */
      emptyStringAsUndefined: true
    });
  }
});

// server/db.ts
var db_exports = {};
__export(db_exports, {
  db: () => db
});
var import_client3, createPrismaClient, globalForPrisma, db;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    import_client3 = require("@prisma/client");
    init_env();
    createPrismaClient = () => {
      const client = new import_client3.PrismaClient({
        log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
      });
      return client;
    };
    globalForPrisma = globalThis;
    db = globalForPrisma.prisma ?? createPrismaClient();
    if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
  }
});

// workers/forecastWorker.ts
var forecastWorker_exports = {};
__export(forecastWorker_exports, {
  JOB_AUTO_COMPLETE_MILESTONES: () => JOB_AUTO_COMPLETE_MILESTONES,
  JOB_MILESTONE_DUE_NOTIFICATIONS: () => JOB_MILESTONE_DUE_NOTIFICATIONS,
  JOB_UPDATE_ALL_CASES: () => JOB_UPDATE_ALL_CASES,
  JOB_UPDATE_SINGLE_CASE: () => JOB_UPDATE_SINGLE_CASE
});
module.exports = __toCommonJS(forecastWorker_exports);
var import_bullmq3 = require("bullmq");

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

// services/forecastService.ts
init_prismaBase();
async function updateRepositoryCaseForecast(repositoryCaseId, options = {}) {
  const prisma2 = options.prismaClient || prisma;
  if (process.env.DEBUG_FORECAST) {
    console.log(
      `Calculating group forecast for RepositoryCase ID: ${repositoryCaseId}`
    );
  }
  try {
    const caseAndLinks = await prisma2.repositoryCases.findUnique({
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
    const allCases = await prisma2.repositoryCases.findMany({
      where: { id: { in: uniqueCaseIds } },
      select: { id: true, source: true }
    });
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] allCases:", allCases);
    const manualCaseIds = allCases.filter((c) => c.source === "MANUAL").map((c) => c.id);
    if (process.env.DEBUG_FORECAST) console.log("[Forecast] manualCaseIds:", manualCaseIds);
    let manualResults = [];
    if (manualCaseIds.length) {
      const testRunCases = await prisma2.testRunCases.findMany({
        where: { repositoryCaseId: { in: manualCaseIds } },
        select: { id: true }
      });
      const testRunCaseIds = testRunCases.map((trc) => trc.id);
      manualResults = testRunCaseIds.length ? await prisma2.testRunResults.findMany({
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
    const junitResults = junitCaseIds.length ? await prisma2.jUnitTestResult.findMany({
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
      await prisma2.repositoryCases.update({
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
    const affectedTestRunCases = await prisma2.testRunCases.findMany({
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
          alreadyRefreshedCaseIds: new Set(uniqueCaseIds),
          prismaClient: prisma2
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
  const prisma2 = options.prismaClient || prisma;
  if (process.env.DEBUG_FORECAST) console.log(`Updating forecast for TestRun ID: ${testRunId}`);
  try {
    let testRunCasesWithDetails = await prisma2.testRunCases.findMany({
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
          { skipTestRunUpdate: true, prismaClient: prisma2 }
        );
        if (result.updatedCaseIds.length > 0) {
          refreshedAnyCase = true;
          for (const refreshedId of result.updatedCaseIds) {
            processedCaseIds.add(refreshedId);
          }
        }
      }
      if (refreshedAnyCase) {
        testRunCasesWithDetails = await prisma2.testRunCases.findMany({
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
      await prisma2.testRuns.update({
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
    const repositoryCases = await prisma2.repositoryCases.findMany({
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
    await prisma2.testRuns.update({
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
async function getUniqueCaseGroupIds(options = {}) {
  const prisma2 = options.prismaClient || prisma;
  if (process.env.DEBUG_FORECAST) console.log("Fetching unique case group representatives...");
  try {
    const BATCH_SIZE = 1e3;
    const processedCaseIds = /* @__PURE__ */ new Set();
    const uniqueRepresentatives = [];
    const allCaseIds = await prisma2.repositoryCases.findMany({
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
      const casesWithLinks = await prisma2.repositoryCases.findMany({
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
var import_node_url2 = require("node:url");

// lib/multiTenantPrisma.ts
var import_client2 = require("@prisma/client");
var fs = __toESM(require("fs"));
function isMultiTenantMode() {
  return process.env.MULTI_TENANT_MODE === "true";
}
function getCurrentTenantId() {
  return process.env.INSTANCE_TENANT_ID;
}
var tenantClients = /* @__PURE__ */ new Map();
var tenantConfigs = null;
var TENANT_CONFIG_FILE = process.env.TENANT_CONFIG_FILE || "/config/tenants.json";
function loadTenantsFromFile(filePath) {
  const configs = /* @__PURE__ */ new Map();
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(fileContent);
      for (const [tenantId, config] of Object.entries(parsed)) {
        configs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex,
          baseUrl: config.baseUrl
        });
      }
      console.log(`Loaded ${configs.size} tenant configurations from ${filePath}`);
    }
  } catch (error) {
    console.error(`Failed to load tenant configs from ${filePath}:`, error);
  }
  return configs;
}
function reloadTenantConfigs() {
  tenantConfigs = null;
  return loadTenantConfigs();
}
function loadTenantConfigs() {
  if (tenantConfigs) {
    return tenantConfigs;
  }
  tenantConfigs = /* @__PURE__ */ new Map();
  const fileConfigs = loadTenantsFromFile(TENANT_CONFIG_FILE);
  for (const [tenantId, config] of fileConfigs) {
    tenantConfigs.set(tenantId, config);
  }
  const configJson = process.env.TENANT_CONFIGS;
  if (configJson) {
    try {
      const configs = JSON.parse(configJson);
      for (const [tenantId, config] of Object.entries(configs)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex,
          baseUrl: config.baseUrl
        });
      }
      console.log(`Loaded ${Object.keys(configs).length} tenant configurations from TENANT_CONFIGS env var`);
    } catch (error) {
      console.error("Failed to parse TENANT_CONFIGS:", error);
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^TENANT_([A-Z0-9_]+)_DATABASE_URL$/);
    if (match && value) {
      const tenantId = match[1].toLowerCase();
      if (!tenantConfigs.has(tenantId)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: value,
          elasticsearchNode: process.env[`TENANT_${match[1]}_ELASTICSEARCH_NODE`],
          elasticsearchIndex: process.env[`TENANT_${match[1]}_ELASTICSEARCH_INDEX`],
          baseUrl: process.env[`TENANT_${match[1]}_BASE_URL`]
        });
      }
    }
  }
  if (tenantConfigs.size === 0) {
    console.warn("No tenant configurations found. Multi-tenant mode will not work without configurations.");
  }
  return tenantConfigs;
}
function getTenantConfig(tenantId) {
  const configs = loadTenantConfigs();
  return configs.get(tenantId);
}
function createTenantPrismaClient(config) {
  const client = new import_client2.PrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl
      }
    },
    errorFormat: "pretty"
  });
  return client;
}
function getTenantPrismaClient(tenantId) {
  reloadTenantConfigs();
  const config = getTenantConfig(tenantId);
  if (!config) {
    throw new Error(`No configuration found for tenant: ${tenantId}`);
  }
  const cached = tenantClients.get(tenantId);
  if (cached) {
    if (cached.databaseUrl === config.databaseUrl) {
      return cached.client;
    } else {
      console.log(`Credentials changed for tenant ${tenantId}, invalidating cached client...`);
      cached.client.$disconnect().catch((err) => {
        console.error(`Error disconnecting stale client for tenant ${tenantId}:`, err);
      });
      tenantClients.delete(tenantId);
    }
  }
  const client = createTenantPrismaClient(config);
  tenantClients.set(tenantId, { client, databaseUrl: config.databaseUrl });
  console.log(`Created Prisma client for tenant: ${tenantId}`);
  return client;
}
function getPrismaClientForJob(jobData) {
  if (!isMultiTenantMode()) {
    const { prisma: prisma2 } = (init_prismaBase(), __toCommonJS(prismaBase_exports));
    return prisma2;
  }
  if (!jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }
  return getTenantPrismaClient(jobData.tenantId);
}
async function disconnectAllTenantClients() {
  const disconnectPromises = [];
  for (const [tenantId, cached] of tenantClients) {
    console.log(`Disconnecting Prisma client for tenant: ${tenantId}`);
    disconnectPromises.push(cached.client.$disconnect());
  }
  await Promise.all(disconnectPromises);
  tenantClients.clear();
  console.log("All tenant Prisma clients disconnected");
}
function validateMultiTenantJobData(jobData) {
  if (isMultiTenantMode() && !jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }
}

// lib/queues.ts
var import_bullmq = require("bullmq");
var _notificationQueue = null;
var _emailQueue = null;
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

// workers/notificationWorker.ts
var import_bullmq2 = require("bullmq");
var import_node_url = require("node:url");
var import_meta = {};
var JOB_CREATE_NOTIFICATION = "create-notification";
var JOB_PROCESS_USER_NOTIFICATIONS = "process-user-notifications";
var JOB_SEND_DAILY_DIGEST = "send-daily-digest";
var processor = async (job) => {
  console.log(`Processing notification job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);
  validateMultiTenantJobData(job.data);
  const prisma2 = getPrismaClientForJob(job.data);
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
            immediate: true,
            tenantId: createData.tenantId
            // Pass tenantId for multi-tenant support
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
      const digestData = job.data;
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
              })),
              tenantId: digestData.tenantId
              // Pass tenantId for multi-tenant support
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
var startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("Notification worker starting in MULTI-TENANT mode");
  } else {
    console.log("Notification worker starting in SINGLE-TENANT mode");
  }
  if (valkey_default) {
    worker = new import_bullmq2.Worker(NOTIFICATION_QUEUE_NAME, processor, {
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
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};
if (typeof import_meta !== "undefined" && import_meta.url === (0, import_node_url.pathToFileURL)(process.argv[1]).href || (typeof import_meta === "undefined" || import_meta.url === void 0)) {
  console.log("Notification worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start notification worker:", err);
    process.exit(1);
  });
}

// lib/services/notificationService.ts
var import_client4 = require("@prisma/client");
var NotificationService = class {
  /**
   * Create a notification for a user
   */
  static async createNotification(params) {
    const notificationQueue = getNotificationQueue();
    if (!notificationQueue) {
      console.warn("Notification queue not available, notification not created");
      return;
    }
    try {
      const jobData = {
        ...params,
        tenantId: getCurrentTenantId()
      };
      const job = await notificationQueue.add(JOB_CREATE_NOTIFICATION, jobData, {
        removeOnComplete: true,
        removeOnFail: false
      });
      console.log(`Queued notification job ${job.id} for user ${params.userId}`);
      return job.id;
    } catch (error) {
      console.error("Failed to queue notification:", error);
      throw error;
    }
  }
  /**
   * Create a work assignment notification
   */
  static async createWorkAssignmentNotification(assignedToId, entityType, entityName, projectName, assignedById, assignedByName, entityId) {
    const title = `New ${entityType === "TestRunCase" ? "Test Case" : "Session"} Assignment`;
    const message = `${assignedByName} assigned you to ${entityType === "TestRunCase" ? "test case" : "session"} "${entityName}" in project "${projectName}"`;
    return this.createNotification({
      userId: assignedToId,
      type: entityType === "TestRunCase" ? import_client4.NotificationType.WORK_ASSIGNED : import_client4.NotificationType.SESSION_ASSIGNED,
      title,
      message,
      relatedEntityId: entityId,
      relatedEntityType: entityType,
      data: {
        assignedById,
        assignedByName,
        projectName,
        entityName
      }
    });
  }
  /**
   * Mark notifications as read
   */
  static async markNotificationsAsRead(notificationIds, userId) {
    return notificationIds;
  }
  /**
   * Get unread notification count for a user
   */
  static async getUnreadCount(userId) {
    return 0;
  }
  /**
   * Create a milestone due reminder notification
   */
  static async createMilestoneDueNotification(userId, milestoneName, projectName, dueDate, milestoneId, projectId, isOverdue) {
    const title = isOverdue ? "Milestone Overdue" : "Milestone Due Soon";
    const message = isOverdue ? `Milestone "${milestoneName}" in project "${projectName}" was due on ${dueDate.toLocaleDateString()}` : `Milestone "${milestoneName}" in project "${projectName}" is due on ${dueDate.toLocaleDateString()}`;
    return this.createNotification({
      userId,
      type: import_client4.NotificationType.MILESTONE_DUE_REMINDER,
      title,
      message,
      relatedEntityId: milestoneId.toString(),
      relatedEntityType: "Milestone",
      data: {
        milestoneName,
        projectName,
        projectId,
        milestoneId,
        dueDate: dueDate.toISOString(),
        isOverdue
      }
    });
  }
  /**
   * Create a user registration notification for all System Admins
   */
  static async createUserRegistrationNotification(newUserName, newUserEmail, newUserId, registrationMethod) {
    const { db: db2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    try {
      const systemAdmins = await db2.user.findMany({
        where: {
          access: "ADMIN",
          isActive: true,
          isDeleted: false
        },
        select: {
          id: true
        }
      });
      if (systemAdmins.length === 0) {
        console.warn("No system administrators found to notify");
        return;
      }
      const title = "New User Registration";
      const method = registrationMethod === "sso" ? "SSO" : "registration form";
      const message = `${newUserName} (${newUserEmail}) has registered via ${method}`;
      const notificationPromises = systemAdmins.map(
        (admin) => this.createNotification({
          userId: admin.id,
          type: import_client4.NotificationType.USER_REGISTERED,
          title,
          message,
          relatedEntityId: newUserId,
          relatedEntityType: "User",
          data: {
            newUserName,
            newUserEmail,
            newUserId,
            registrationMethod
          }
        })
      );
      await Promise.all(notificationPromises);
      console.log(`Created user registration notifications for ${systemAdmins.length} system administrators`);
    } catch (error) {
      console.error("Failed to create user registration notifications:", error);
    }
  }
};

// workers/forecastWorker.ts
var import_meta2 = {};
var JOB_UPDATE_SINGLE_CASE = "update-single-case-forecast";
var JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";
var JOB_AUTO_COMPLETE_MILESTONES = "auto-complete-milestones";
var JOB_MILESTONE_DUE_NOTIFICATIONS = "milestone-due-notifications";
var processor2 = async (job) => {
  console.log(
    `Processing job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
  );
  let successCount = 0;
  let failCount = 0;
  validateMultiTenantJobData(job.data);
  const prisma2 = getPrismaClientForJob(job.data);
  switch (job.name) {
    case JOB_UPDATE_SINGLE_CASE:
      const singleData = job.data;
      if (!singleData || typeof singleData.repositoryCaseId !== "number") {
        throw new Error(
          `Invalid data for job ${job.id}: repositoryCaseId missing or not a number.`
        );
      }
      try {
        await updateRepositoryCaseForecast(singleData.repositoryCaseId, {
          prismaClient: prisma2
        });
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
      const caseIds = await getUniqueCaseGroupIds({ prismaClient: prisma2 });
      const affectedTestRunIds = /* @__PURE__ */ new Set();
      for (const caseId of caseIds) {
        try {
          const result = await updateRepositoryCaseForecast(caseId, {
            skipTestRunUpdate: true,
            collectAffectedTestRuns: true,
            prismaClient: prisma2
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
      const activeTestRuns = await prisma2.testRuns.findMany({
        where: {
          id: { in: Array.from(affectedTestRunIds) },
          isCompleted: false
        },
        select: { id: true }
      });
      const activeTestRunIds = activeTestRuns.map(
        (tr) => tr.id
      );
      const skippedCompletedCount = affectedTestRunIds.size - activeTestRunIds.length;
      console.log(
        `Job ${job.id}: Updating ${activeTestRunIds.length} active test runs (skipped ${skippedCompletedCount} completed)...`
      );
      let testRunSuccessCount = 0;
      let testRunFailCount = 0;
      for (const testRunId of activeTestRunIds) {
        try {
          await updateTestRunForecast(testRunId, { prismaClient: prisma2 });
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
    case JOB_AUTO_COMPLETE_MILESTONES:
      console.log(
        `Job ${job.id}: Starting auto-completion check for milestones.`
      );
      try {
        const now = /* @__PURE__ */ new Date();
        const milestonesToComplete = await prisma2.milestones.findMany({
          where: {
            isCompleted: false,
            isDeleted: false,
            automaticCompletion: true,
            completedAt: {
              lte: now
              // Due date has passed
            }
          },
          select: {
            id: true,
            name: true,
            projectId: true
          }
        });
        console.log(
          `Job ${job.id}: Found ${milestonesToComplete.length} milestones to auto-complete.`
        );
        for (const milestone of milestonesToComplete) {
          try {
            await prisma2.milestones.update({
              where: { id: milestone.id },
              data: { isCompleted: true }
            });
            successCount++;
            console.log(
              `Job ${job.id}: Auto-completed milestone "${milestone.name}" (ID: ${milestone.id})`
            );
          } catch (error) {
            failCount++;
            console.error(
              `Job ${job.id}: Failed to auto-complete milestone ${milestone.id}`,
              error
            );
          }
        }
        console.log(
          `Job ${job.id} completed: Auto-completed ${successCount} milestones. Failed: ${failCount}`
        );
      } catch (error) {
        console.error(
          `Job ${job.id}: Error in auto-complete milestones job`,
          error
        );
        throw error;
      }
      break;
    case JOB_MILESTONE_DUE_NOTIFICATIONS:
      console.log(`Job ${job.id}: Starting milestone due notifications check.`);
      try {
        const now = /* @__PURE__ */ new Date();
        const milestonesToNotify = await prisma2.milestones.findMany({
          where: {
            isCompleted: false,
            isDeleted: false,
            notifyDaysBefore: { gt: 0 },
            completedAt: { not: null }
            // Has a due date
          },
          select: {
            id: true,
            name: true,
            completedAt: true,
            notifyDaysBefore: true,
            createdBy: true,
            // Milestone creator
            project: {
              select: {
                id: true,
                name: true
              }
            },
            // Get all users who have participated in this milestone's test runs
            testRuns: {
              where: {
                isDeleted: false
              },
              select: {
                createdById: true,
                // Test run creator
                testCases: {
                  select: {
                    assignedToId: true,
                    // Assigned user
                    results: {
                      select: {
                        executedById: true
                        // User who executed the result
                      }
                    }
                  }
                }
              }
            },
            // Get all users who have participated in this milestone's sessions
            sessions: {
              where: {
                isDeleted: false
              },
              select: {
                createdById: true,
                // Session creator
                assignedToId: true
                // Assigned user
              }
            }
          }
        });
        console.log(
          `Job ${job.id}: Found ${milestonesToNotify.length} milestones to check for notifications.`
        );
        for (const milestone of milestonesToNotify) {
          if (!milestone.completedAt) continue;
          const dueDate = new Date(milestone.completedAt);
          const timeDiff = dueDate.getTime() - now.getTime();
          const daysDiff = Math.floor(timeDiff / (1e3 * 60 * 60 * 24));
          const isOverdue = daysDiff < 0;
          const shouldNotify = isOverdue || daysDiff <= milestone.notifyDaysBefore;
          console.log(
            `Job ${job.id}: Milestone "${milestone.name}" (ID: ${milestone.id}) - daysDiff: ${daysDiff}, notifyDaysBefore: ${milestone.notifyDaysBefore}, isOverdue: ${isOverdue}, shouldNotify: ${shouldNotify}`
          );
          if (!shouldNotify) continue;
          const userIds = /* @__PURE__ */ new Set();
          if (milestone.createdBy) {
            userIds.add(milestone.createdBy);
          }
          for (const testRun of milestone.testRuns) {
            if (testRun.createdById) {
              userIds.add(testRun.createdById);
            }
            for (const testCase of testRun.testCases) {
              if (testCase.assignedToId) {
                userIds.add(testCase.assignedToId);
              }
              for (const result of testCase.results) {
                if (result.executedById) {
                  userIds.add(result.executedById);
                }
              }
            }
          }
          for (const session of milestone.sessions) {
            if (session.createdById) {
              userIds.add(session.createdById);
            }
            if (session.assignedToId) {
              userIds.add(session.assignedToId);
            }
          }
          if (userIds.size === 0) {
            console.log(
              `Job ${job.id}: Milestone "${milestone.name}" (ID: ${milestone.id}) - no participating users found, skipping notifications`
            );
            continue;
          }
          console.log(
            `Job ${job.id}: Milestone "${milestone.name}" (ID: ${milestone.id}) - sending notifications to ${userIds.size} users`
          );
          for (const userId of userIds) {
            try {
              await NotificationService.createMilestoneDueNotification(
                userId,
                milestone.name,
                milestone.project.name,
                dueDate,
                milestone.id,
                milestone.project.id,
                isOverdue
              );
              successCount++;
            } catch (error) {
              failCount++;
              console.error(
                `Job ${job.id}: Failed to send notification for milestone ${milestone.id} to user ${userId}`,
                error
              );
            }
          }
        }
        console.log(
          `Job ${job.id} completed: Sent ${successCount} milestone notifications. Failed: ${failCount}`
        );
      } catch (error) {
        console.error(
          `Job ${job.id}: Error in milestone due notifications job`,
          error
        );
        throw error;
      }
      break;
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
  return { status: "completed", successCount, failCount };
};
async function startWorker2() {
  if (isMultiTenantMode()) {
    console.log("Forecast worker starting in MULTI-TENANT mode");
  } else {
    console.log("Forecast worker starting in SINGLE-TENANT mode");
  }
  if (valkey_default) {
    const worker2 = new import_bullmq3.Worker(FORECAST_QUEUE_NAME, processor2, {
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
      if (isMultiTenantMode()) {
        await disconnectAllTenantClients();
      }
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
if (typeof import_meta2 !== "undefined" && import_meta2.url === (0, import_node_url2.pathToFileURL)(process.argv[1]).href || typeof import_meta2 === "undefined" || import_meta2.url === void 0) {
  startWorker2().catch((err) => {
    console.error("Failed to start worker:", err);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JOB_AUTO_COMPLETE_MILESTONES,
  JOB_MILESTONE_DUE_NOTIFICATIONS,
  JOB_UPDATE_ALL_CASES,
  JOB_UPDATE_SINGLE_CASE
});
//# sourceMappingURL=forecastWorker.js.map
