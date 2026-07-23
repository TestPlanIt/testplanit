// lib/multiTenantDb.ts
// Multi-tenant ZenStack client factory for shared worker containers

import { ZenStackClient } from "@zenstackhq/orm";
import * as fs from "fs";

import { getPoolConfig } from "~/lib/db/poolConfig";
import { createDialect } from "~/lib/db/readWriteDialect";
import { type DbClient } from "~/lib/zenstack";
import { schema } from "~/zenstack/schema";

/**
 * Tenant configuration interface
 */
export interface TenantConfig {
  tenantId: string;
  databaseUrl: string;
  // Per-tenant read replicas. Read/write splitting for a tenant client is
  // opt-in per tenant: a tenant's reads may only be routed to that tenant's own
  // replicas, never the process-wide DATABASE_REPLICA_URLS (which belong to the
  // single-tenant app database). Empty/absent → the tenant client uses a single
  // primary pool.
  replicaUrls?: string[];
  elasticsearchNode?: string;
  elasticsearchIndex?: string;
  baseUrl?: string;
}

// Normalize a replica-URL value that may arrive as a JSON array (config file /
// TENANT_CONFIGS) or a comma-separated string (individual env var).
function parseReplicaUrls(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const urls = value.map((u) => String(u).trim()).filter((u) => u.length > 0);
    return urls.length > 0 ? urls : undefined;
  }
  if (typeof value === "string") {
    const urls = value
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    return urls.length > 0 ? urls : undefined;
  }
  return undefined;
}

/**
 * Check if multi-tenant mode is enabled
 */
export function isMultiTenantMode(): boolean {
  return process.env.MULTI_TENANT_MODE === "true";
}

/**
 * Get the current instance's tenant ID
 * In multi-tenant deployments, each web app instance belongs to a single tenant.
 * Set via INSTANCE_TENANT_ID environment variable.
 *
 * Note: This returns the tenant ID whenever INSTANCE_TENANT_ID is set,
 * regardless of whether MULTI_TENANT_MODE is enabled. This allows web app
 * instances to include their tenant ID in queued jobs, which the shared
 * worker (running with MULTI_TENANT_MODE=true) can then use to route
 * database operations to the correct tenant.
 *
 * Returns undefined if INSTANCE_TENANT_ID is not configured.
 */
export function getCurrentTenantId(): string | undefined {
  return process.env.INSTANCE_TENANT_ID;
}

/**
 * Cache of ZenStack clients per tenant to avoid creating new connections for each job
 * Stores both the client and the database URL used to create it (for credential change detection)
 */
interface CachedClient {
  client: DbClient;
  databaseUrl: string;
  // Serialized replica list, so a change to a tenant's replicas invalidates the
  // cached client the same way a databaseUrl change does.
  replicaSignature: string;
}
const tenantClients: Map<string, CachedClient> = new Map();

/**
 * Tenant configurations loaded from environment or config file
 */
let tenantConfigs: Map<string, TenantConfig> | null = null;

/**
 * Path to the tenant config file (can be set via TENANT_CONFIG_FILE env var)
 */
const TENANT_CONFIG_FILE =
  process.env.TENANT_CONFIG_FILE || "/config/tenants.json";

/**
 * Load tenant configurations from file
 */
function loadTenantsFromFile(filePath: string): Map<string, TenantConfig> {
  const configs = new Map<string, TenantConfig>();

  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(fileContent) as Record<
        string,
        Omit<TenantConfig, "tenantId">
      >;
      for (const [tenantId, config] of Object.entries(parsed)) {
        configs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          replicaUrls: parseReplicaUrls(config.replicaUrls),
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex,
          baseUrl: config.baseUrl,
        });
      }
      console.log(
        `Loaded ${configs.size} tenant configurations from ${filePath}`
      );
    }
  } catch (error) {
    console.error(`Failed to load tenant configs from ${filePath}:`, error);
  }

  return configs;
}

/**
 * Reload tenant configurations from file (for dynamic updates)
 * This allows adding new tenants without restarting workers
 */
export function reloadTenantConfigs(): Map<string, TenantConfig> {
  // Clear cached configs
  tenantConfigs = null;
  // Reload
  return loadTenantConfigs();
}

/**
 * Load tenant configurations from:
 * 1. Config file (TENANT_CONFIG_FILE env var or /config/tenants.json)
 * 2. TENANT_CONFIGS environment variable (JSON string)
 * 3. Individual environment variables: TENANT_<ID>_DATABASE_URL, etc.
 */
export function loadTenantConfigs(): Map<string, TenantConfig> {
  if (tenantConfigs) {
    return tenantConfigs;
  }

  tenantConfigs = new Map();

  // Priority 1: Load from config file
  const fileConfigs = loadTenantsFromFile(TENANT_CONFIG_FILE);
  for (const [tenantId, config] of fileConfigs) {
    tenantConfigs.set(tenantId, config);
  }

  // Priority 2: Load from TENANT_CONFIGS env var (can override file configs)
  const configJson = process.env.TENANT_CONFIGS;
  if (configJson) {
    try {
      const configs = JSON.parse(configJson) as Record<
        string,
        Omit<TenantConfig, "tenantId">
      >;
      for (const [tenantId, config] of Object.entries(configs)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          replicaUrls: parseReplicaUrls(config.replicaUrls),
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex,
          baseUrl: config.baseUrl,
        });
      }
      console.log(
        `Loaded ${Object.keys(configs).length} tenant configurations from TENANT_CONFIGS env var`
      );
    } catch (error) {
      console.error("Failed to parse TENANT_CONFIGS:", error);
    }
  }

  // Priority 3: Individual tenant environment variables
  // Format: TENANT_<TENANT_ID>_DATABASE_URL, TENANT_<TENANT_ID>_ELASTICSEARCH_NODE, TENANT_<TENANT_ID>_BASE_URL
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^TENANT_([A-Z0-9_]+)_DATABASE_URL$/);
    if (match && value) {
      const tenantId = match[1].toLowerCase();
      if (!tenantConfigs.has(tenantId)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: value,
          replicaUrls: parseReplicaUrls(
            process.env[`TENANT_${match[1]}_DATABASE_REPLICA_URLS`]
          ),
          elasticsearchNode:
            process.env[`TENANT_${match[1]}_ELASTICSEARCH_NODE`],
          elasticsearchIndex:
            process.env[`TENANT_${match[1]}_ELASTICSEARCH_INDEX`],
          baseUrl: process.env[`TENANT_${match[1]}_BASE_URL`],
        });
      }
    }
  }

  if (tenantConfigs.size === 0) {
    console.warn(
      "No tenant configurations found. Multi-tenant mode will not work without configurations."
    );
  }

  return tenantConfigs;
}

/**
 * Get tenant configuration by ID
 */
export function getTenantConfig(tenantId: string): TenantConfig | undefined {
  const configs = loadTenantConfigs();
  return configs.get(tenantId);
}

/**
 * Get all tenant IDs
 */
export function getAllTenantIds(): string[] {
  const configs = loadTenantConfigs();
  return Array.from(configs.keys());
}

/**
 * Create a ZenStack client for a specific tenant
 */
function createTenantDbClient(config: TenantConfig): DbClient {
  const client = new ZenStackClient(schema, {
    // Per-tenant replicas only (never the process-wide app replica list).
    // Pool sizing is process-wide (see lib/db/poolConfig.ts) and applies per
    // tenant client, so DATABASE_POOL_MAX is multiplied by the tenant count.
    dialect: createDialect(
      config.databaseUrl,
      config.replicaUrls ?? [],
      getPoolConfig()
    ),
  });

  return client;
}

/**
 * Get or create a ZenStack client for a specific tenant
 * Caches clients to reuse connections
 * Supports dynamic tenant addition by reloading configs if tenant not found
 * Automatically invalidates cached clients when credentials change
 */
export function getTenantDbClient(tenantId: string): DbClient {
  // Always reload config from file to get latest credentials
  reloadTenantConfigs();
  const config = getTenantConfig(tenantId);

  if (!config) {
    throw new Error(`No configuration found for tenant: ${tenantId}`);
  }

  // Check cache - but invalidate if credentials or replicas have changed
  const replicaSignature = (config.replicaUrls ?? []).join(",");
  const cached = tenantClients.get(tenantId);
  if (cached) {
    if (
      cached.databaseUrl === config.databaseUrl &&
      cached.replicaSignature === replicaSignature
    ) {
      // Credentials + replicas unchanged, reuse cached client
      return cached.client;
    } else {
      // Credentials or replicas changed - disconnect old client and create new one
      console.log(
        `Config changed for tenant ${tenantId}, invalidating cached client...`
      );
      cached.client.$disconnect().catch((err) => {
        console.error(
          `Error disconnecting stale client for tenant ${tenantId}:`,
          err
        );
      });
      tenantClients.delete(tenantId);
    }
  }

  // Create and cache new client
  const client = createTenantDbClient(config);
  tenantClients.set(tenantId, {
    client,
    databaseUrl: config.databaseUrl,
    replicaSignature,
  });
  console.log(`Created ZenStack client for tenant: ${tenantId}`);

  return client;
}

/**
 * Get a ZenStack client based on job data
 * In single-tenant mode, returns the default client
 * In multi-tenant mode, returns tenant-specific client
 */
export function getDbClientForJob(jobData: { tenantId?: string }): DbClient {
  if (!isMultiTenantMode()) {
    // Single-tenant mode: use lightweight ZenStack client (no ES sync extensions)
    // Import lazily to avoid circular dependencies
    const { rawDb } = require("./rawDb");
    return rawDb;
  }

  // Multi-tenant mode: require tenantId
  if (!jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }

  return getTenantDbClient(jobData.tenantId);
}

/**
 * Disconnect all tenant clients (for graceful shutdown)
 */
export async function disconnectAllTenantClients(): Promise<void> {
  const disconnectPromises: Promise<void>[] = [];

  for (const [tenantId, cached] of tenantClients) {
    console.log(`Disconnecting ZenStack client for tenant: ${tenantId}`);
    disconnectPromises.push(cached.client.$disconnect());
  }

  await Promise.all(disconnectPromises);
  tenantClients.clear();
  console.log("All tenant ZenStack clients disconnected");
}

/**
 * Base interface for job data that supports multi-tenancy
 */
export interface MultiTenantJobData {
  tenantId?: string; // Optional in single-tenant mode, required in multi-tenant mode
}

/**
 * Validate job data for multi-tenant mode
 */
export function validateMultiTenantJobData(jobData: MultiTenantJobData): void {
  if (isMultiTenantMode() && !jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }
}
