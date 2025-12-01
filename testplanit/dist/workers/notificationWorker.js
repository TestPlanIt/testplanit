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
      prismaClient = new import_client.PrismaClient({
        errorFormat: "pretty"
      });
    } else {
      if (!global.prismaBase) {
        global.prismaBase = new import_client.PrismaClient({
          errorFormat: "colorless"
        });
      }
      prismaClient = global.prismaBase;
    }
    prisma = prismaClient;
  }
});

// workers/notificationWorker.ts
var notificationWorker_exports = {};
__export(notificationWorker_exports, {
  JOB_CREATE_NOTIFICATION: () => JOB_CREATE_NOTIFICATION,
  JOB_PROCESS_USER_NOTIFICATIONS: () => JOB_PROCESS_USER_NOTIFICATIONS,
  JOB_SEND_DAILY_DIGEST: () => JOB_SEND_DAILY_DIGEST,
  default: () => notificationWorker_default,
  processor: () => processor
});
module.exports = __toCommonJS(notificationWorker_exports);
var import_bullmq2 = require("bullmq");

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
var NOTIFICATION_QUEUE_NAME = "notifications";
var EMAIL_QUEUE_NAME = "emails";

// lib/queues.ts
var _emailQueue = null;
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
var import_node_url = require("node:url");

// lib/multiTenantPrisma.ts
var import_client2 = require("@prisma/client");
function isMultiTenantMode() {
  return process.env.MULTI_TENANT_MODE === "true";
}
var tenantClients = /* @__PURE__ */ new Map();
var tenantConfigs = null;
function loadTenantConfigs() {
  if (tenantConfigs) {
    return tenantConfigs;
  }
  tenantConfigs = /* @__PURE__ */ new Map();
  const configJson = process.env.TENANT_CONFIGS;
  if (configJson) {
    try {
      const configs = JSON.parse(configJson);
      for (const [tenantId, config] of Object.entries(configs)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex
        });
      }
      console.log(`Loaded ${tenantConfigs.size} tenant configurations from TENANT_CONFIGS`);
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
          elasticsearchIndex: process.env[`TENANT_${match[1]}_ELASTICSEARCH_INDEX`]
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
  let client = tenantClients.get(tenantId);
  if (client) {
    return client;
  }
  const config = getTenantConfig(tenantId);
  if (!config) {
    throw new Error(`No configuration found for tenant: ${tenantId}`);
  }
  client = createTenantPrismaClient(config);
  tenantClients.set(tenantId, client);
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
  for (const [tenantId, client] of tenantClients) {
    console.log(`Disconnecting Prisma client for tenant: ${tenantId}`);
    disconnectPromises.push(client.$disconnect());
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

// workers/notificationWorker.ts
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
var notificationWorker_default = worker;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JOB_CREATE_NOTIFICATION,
  JOB_PROCESS_USER_NOTIFICATIONS,
  JOB_SEND_DAILY_DIGEST,
  processor
});
//# sourceMappingURL=notificationWorker.js.map
