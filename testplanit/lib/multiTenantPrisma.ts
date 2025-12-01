// lib/multiTenantPrisma.ts
// Multi-tenant Prisma client factory for shared worker containers

import { PrismaClient } from "@prisma/client";

/**
 * Tenant configuration interface
 */
export interface TenantConfig {
  tenantId: string;
  databaseUrl: string;
  elasticsearchNode?: string;
  elasticsearchIndex?: string;
}

/**
 * Check if multi-tenant mode is enabled
 */
export function isMultiTenantMode(): boolean {
  return process.env.MULTI_TENANT_MODE === "true";
}

/**
 * Get the current instance's tenant ID
 * In multi-tenant mode, each web app instance belongs to a single tenant
 * Set via INSTANCE_TENANT_ID environment variable
 * Returns undefined in single-tenant mode or if not configured
 */
export function getCurrentTenantId(): string | undefined {
  if (!isMultiTenantMode()) {
    return undefined;
  }
  return process.env.INSTANCE_TENANT_ID;
}

/**
 * Cache of Prisma clients per tenant to avoid creating new connections for each job
 */
const tenantClients: Map<string, PrismaClient> = new Map();

/**
 * Tenant configurations loaded from environment or config file
 */
let tenantConfigs: Map<string, TenantConfig> | null = null;

/**
 * Load tenant configurations from environment variable
 * Expected format: TENANT_CONFIGS='{"tenant1": {"databaseUrl": "...", "elasticsearchNode": "..."}, ...}'
 * Or from individual environment variables: TENANT_<ID>_DATABASE_URL, TENANT_<ID>_ELASTICSEARCH_NODE
 */
export function loadTenantConfigs(): Map<string, TenantConfig> {
  if (tenantConfigs) {
    return tenantConfigs;
  }

  tenantConfigs = new Map();

  // Try loading from JSON config first
  const configJson = process.env.TENANT_CONFIGS;
  if (configJson) {
    try {
      const configs = JSON.parse(configJson) as Record<string, Omit<TenantConfig, "tenantId">>;
      for (const [tenantId, config] of Object.entries(configs)) {
        tenantConfigs.set(tenantId, {
          tenantId,
          databaseUrl: config.databaseUrl,
          elasticsearchNode: config.elasticsearchNode,
          elasticsearchIndex: config.elasticsearchIndex,
        });
      }
      console.log(`Loaded ${tenantConfigs.size} tenant configurations from TENANT_CONFIGS`);
    } catch (error) {
      console.error("Failed to parse TENANT_CONFIGS:", error);
    }
  }

  // Also check for individual tenant environment variables
  // Format: TENANT_<TENANT_ID>_DATABASE_URL, TENANT_<TENANT_ID>_ELASTICSEARCH_NODE
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
        });
      }
    }
  }

  if (tenantConfigs.size === 0) {
    console.warn("No tenant configurations found. Multi-tenant mode will not work without configurations.");
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
 * Create a Prisma client for a specific tenant
 */
function createTenantPrismaClient(config: TenantConfig): PrismaClient {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl,
      },
    },
    errorFormat: "pretty",
  });

  return client;
}

/**
 * Get or create a Prisma client for a specific tenant
 * Caches clients to reuse connections
 */
export function getTenantPrismaClient(tenantId: string): PrismaClient {
  // Check cache first
  let client = tenantClients.get(tenantId);
  if (client) {
    return client;
  }

  // Get tenant config
  const config = getTenantConfig(tenantId);
  if (!config) {
    throw new Error(`No configuration found for tenant: ${tenantId}`);
  }

  // Create and cache new client
  client = createTenantPrismaClient(config);
  tenantClients.set(tenantId, client);
  console.log(`Created Prisma client for tenant: ${tenantId}`);

  return client;
}

/**
 * Get a Prisma client based on job data
 * In single-tenant mode, returns the default client
 * In multi-tenant mode, returns tenant-specific client
 */
export function getPrismaClientForJob(jobData: { tenantId?: string }): PrismaClient {
  if (!isMultiTenantMode()) {
    // Single-tenant mode: use default Prisma client
    // Import lazily to avoid circular dependencies
    const { prisma } = require("./prisma");
    return prisma;
  }

  // Multi-tenant mode: require tenantId
  if (!jobData.tenantId) {
    throw new Error("tenantId is required in multi-tenant mode");
  }

  return getTenantPrismaClient(jobData.tenantId);
}

/**
 * Disconnect all tenant clients (for graceful shutdown)
 */
export async function disconnectAllTenantClients(): Promise<void> {
  const disconnectPromises: Promise<void>[] = [];

  for (const [tenantId, client] of tenantClients) {
    console.log(`Disconnecting Prisma client for tenant: ${tenantId}`);
    disconnectPromises.push(client.$disconnect());
  }

  await Promise.all(disconnectPromises);
  tenantClients.clear();
  console.log("All tenant Prisma clients disconnected");
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
