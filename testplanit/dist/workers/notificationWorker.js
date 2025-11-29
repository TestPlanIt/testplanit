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
var FORECAST_QUEUE_NAME = "forecast-updates";
var NOTIFICATION_QUEUE_NAME = "notifications";
var EMAIL_QUEUE_NAME = "emails";
var SYNC_QUEUE_NAME = "issue-sync";
var TESTMO_IMPORT_QUEUE_NAME = "testmo-imports";
var ELASTICSEARCH_REINDEX_QUEUE_NAME = "elasticsearch-reindex";

// lib/queues.ts
var forecastQueue = null;
var notificationQueue = null;
var emailQueue = null;
var syncQueue = null;
var testmoImportQueue = null;
var elasticsearchReindexQueue = null;
if (valkey_default) {
  forecastQueue = new import_bullmq.Queue(FORECAST_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      // Configuration for jobs in this queue (optional)
      attempts: 3,
      // Number of times to retry a failed job
      backoff: {
        type: "exponential",
        // Exponential backoff strategy
        delay: 5e3
        // Initial delay 5s
      },
      removeOnComplete: {
        age: 3600 * 24 * 7,
        // keep up to 7 days
        count: 1e3
        // keep up to 1000 jobs
      },
      removeOnFail: {
        age: 3600 * 24 * 14
        // keep up to 14 days
      }
    }
  });
  console.log(`Queue "${FORECAST_QUEUE_NAME}" initialized.`);
  forecastQueue.on("error", (error) => {
    console.error(`Queue ${FORECAST_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${FORECAST_QUEUE_NAME}" not initialized.`
  );
}
if (valkey_default) {
  notificationQueue = new import_bullmq.Queue(NOTIFICATION_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5e3
      },
      removeOnComplete: {
        age: 3600 * 24 * 7,
        // keep up to 7 days
        count: 1e3
      },
      removeOnFail: {
        age: 3600 * 24 * 14
        // keep up to 14 days
      }
    }
  });
  console.log(`Queue "${NOTIFICATION_QUEUE_NAME}" initialized.`);
  notificationQueue.on("error", (error) => {
    console.error(`Queue ${NOTIFICATION_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${NOTIFICATION_QUEUE_NAME}" not initialized.`
  );
}
if (valkey_default) {
  emailQueue = new import_bullmq.Queue(EMAIL_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1e4
      },
      removeOnComplete: {
        age: 3600 * 24 * 30,
        // keep up to 30 days
        count: 5e3
      },
      removeOnFail: {
        age: 3600 * 24 * 30
        // keep up to 30 days
      }
    }
  });
  console.log(`Queue "${EMAIL_QUEUE_NAME}" initialized.`);
  emailQueue.on("error", (error) => {
    console.error(`Queue ${EMAIL_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${EMAIL_QUEUE_NAME}" not initialized.`
  );
}
if (valkey_default) {
  syncQueue = new import_bullmq.Queue(SYNC_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5e3
      },
      removeOnComplete: {
        age: 3600 * 24 * 3,
        // keep up to 3 days
        count: 500
      },
      removeOnFail: {
        age: 3600 * 24 * 7
        // keep up to 7 days
      }
    }
  });
  console.log(`Queue "${SYNC_QUEUE_NAME}" initialized.`);
  syncQueue.on("error", (error) => {
    console.error(`Queue ${SYNC_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${SYNC_QUEUE_NAME}" not initialized.`
  );
}
if (valkey_default) {
  testmoImportQueue = new import_bullmq.Queue(TESTMO_IMPORT_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: {
        age: 3600 * 24 * 30,
        count: 100
      },
      removeOnFail: {
        age: 3600 * 24 * 30
      }
    }
  });
  console.log(`Queue "${TESTMO_IMPORT_QUEUE_NAME}" initialized.`);
  testmoImportQueue.on("error", (error) => {
    console.error(`Queue ${TESTMO_IMPORT_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${TESTMO_IMPORT_QUEUE_NAME}" not initialized.`
  );
}
if (valkey_default) {
  elasticsearchReindexQueue = new import_bullmq.Queue(ELASTICSEARCH_REINDEX_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 1,
      // Don't retry reindex jobs automatically
      removeOnComplete: {
        age: 3600 * 24 * 7,
        // keep up to 7 days
        count: 50
      },
      removeOnFail: {
        age: 3600 * 24 * 14
        // keep up to 14 days
      }
    }
  });
  console.log(`Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" initialized.`);
  elasticsearchReindexQueue.on("error", (error) => {
    console.error(`Queue ${ELASTICSEARCH_REINDEX_QUEUE_NAME} error:`, error);
  });
} else {
  console.warn(
    `Valkey connection not available, Queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}" not initialized.`
  );
}

// workers/notificationWorker.ts
var import_client = require("@prisma/client");
var import_node_url = require("node:url");
var import_meta = {};
var prisma = new import_client.PrismaClient();
var JOB_CREATE_NOTIFICATION = "create-notification";
var JOB_PROCESS_USER_NOTIFICATIONS = "process-user-notifications";
var JOB_SEND_DAILY_DIGEST = "send-daily-digest";
var processor = async (job) => {
  console.log(`Processing notification job ${job.id} of type ${job.name}`);
  switch (job.name) {
    case JOB_CREATE_NOTIFICATION:
      const createData = job.data;
      try {
        const userPreferences = await prisma.userPreferences.findUnique({
          where: { userId: createData.userId }
        });
        const globalSettings = await prisma.appConfig.findUnique({
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
        const notification = await prisma.notification.create({
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
          await emailQueue?.add("send-notification-email", {
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
        const notifications = await prisma.notification.findMany({
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
        const globalSettings = await prisma.appConfig.findUnique({
          where: { key: "notificationSettings" }
        });
        const settingsValue = globalSettings?.value;
        const globalDefaultMode = settingsValue?.defaultMode || "IN_APP";
        const users = await prisma.userPreferences.findMany({
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
          const notifications = await prisma.notification.findMany({
            where: {
              userId: userPref.userId,
              isRead: false,
              isDeleted: false,
              createdAt: { gte: yesterday }
            },
            orderBy: { createdAt: "desc" }
          });
          if (notifications.length > 0) {
            await emailQueue?.add("send-digest-email", {
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
var startWorker = async () => {
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
    await prisma.$disconnect();
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
