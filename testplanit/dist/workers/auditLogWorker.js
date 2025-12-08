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

// workers/auditLogWorker.ts
var auditLogWorker_exports = {};
__export(auditLogWorker_exports, {
  default: () => auditLogWorker_default,
  processor: () => processor,
  startWorker: () => startWorker
});
module.exports = __toCommonJS(auditLogWorker_exports);
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
var AUDIT_LOG_QUEUE_NAME = "audit-logs";

// workers/auditLogWorker.ts
var import_node_url = require("node:url");

// lib/multiTenantPrisma.ts
var import_client2 = require("@prisma/client");
var fs = __toESM(require("fs"));
function isMultiTenantMode() {
  return process.env.MULTI_TENANT_MODE === "true";
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

// workers/auditLogWorker.ts
var import_meta = {};
var processor = async (job) => {
  const { event, context, queuedAt } = job.data;
  console.log(
    `[AuditLogWorker] Processing audit event: ${event.action} ${event.entityType}:${event.entityId}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
  );
  validateMultiTenantJobData(job.data);
  const prisma2 = getPrismaClientForJob(job.data);
  try {
    const userId = event.userId || context?.userId || null;
    const userEmail = event.userEmail || context?.userEmail || null;
    const userName = event.userName || context?.userName || null;
    const metadata = {
      ...event.metadata || {},
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      queuedAt,
      processedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    for (const key of Object.keys(metadata)) {
      if (metadata[key] === void 0) {
        delete metadata[key];
      }
    }
    let validatedProjectId = null;
    if (event.projectId) {
      const projectExists = await prisma2.projects.findUnique({
        where: { id: event.projectId },
        select: { id: true }
      });
      if (projectExists) {
        validatedProjectId = event.projectId;
      } else {
        metadata.originalProjectId = event.projectId;
        console.warn(
          `[AuditLogWorker] Project ${event.projectId} no longer exists, creating audit log without project association`
        );
      }
    }
    await prisma2.auditLog.create({
      data: {
        userId,
        userEmail,
        userName,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        entityName: event.entityName || null,
        changes: event.changes,
        metadata: Object.keys(metadata).length > 0 ? metadata : void 0,
        projectId: validatedProjectId
      }
    });
    console.log(
      `[AuditLogWorker] Successfully logged: ${event.action} ${event.entityType}:${event.entityId}`
    );
  } catch (error) {
    console.error(`[AuditLogWorker] Failed to create audit log:`, error);
    throw error;
  }
};
var worker = null;
var startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("[AuditLogWorker] Starting in MULTI-TENANT mode");
  } else {
    console.log("[AuditLogWorker] Starting in SINGLE-TENANT mode");
  }
  if (valkey_default) {
    worker = new import_bullmq2.Worker(AUDIT_LOG_QUEUE_NAME, processor, {
      connection: valkey_default,
      concurrency: 10
      // Higher concurrency since audit logs are independent
    });
    worker.on("completed", (job) => {
    });
    worker.on("failed", (job, err) => {
      console.error(`[AuditLogWorker] Job ${job?.id} failed:`, err);
    });
    worker.on("error", (err) => {
      console.error("[AuditLogWorker] Worker error:", err);
    });
    console.log(`[AuditLogWorker] Started for queue "${AUDIT_LOG_QUEUE_NAME}"`);
  } else {
    console.warn(
      "[AuditLogWorker] Valkey connection not available. Worker not started."
    );
  }
  process.on("SIGINT", async () => {
    console.log("[AuditLogWorker] Shutting down...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    console.log("[AuditLogWorker] Received SIGTERM, shutting down...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};
if (typeof import_meta !== "undefined" && import_meta.url === (0, import_node_url.pathToFileURL)(process.argv[1]).href || (typeof import_meta === "undefined" || import_meta?.url === void 0)) {
  console.log("[AuditLogWorker] Running as standalone process...");
  startWorker().catch((err) => {
    console.error("[AuditLogWorker] Failed to start:", err);
    process.exit(1);
  });
}
var auditLogWorker_default = worker;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  processor,
  startWorker
});
//# sourceMappingURL=auditLogWorker.js.map
