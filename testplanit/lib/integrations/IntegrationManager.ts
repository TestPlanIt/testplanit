import { prisma } from "@/lib/prisma";
import type { Integration, IntegrationProvider } from "@prisma/client";
import { IssueAdapter } from "./adapters/IssueAdapter";
import { JiraAdapter } from "./adapters/JiraAdapter";
import { GitHubAdapter } from "./adapters/GitHubAdapter";
import { AzureDevOpsAdapter } from "./adapters/AzureDevOpsAdapter";
import { SimpleUrlAdapter } from "./adapters/SimpleUrlAdapter";
import { EncryptionService, getMasterKey } from "@/utils/encryption";

/**
 * Central service for managing integrations and their adapters
 */
export class IntegrationManager {
  private static instance: IntegrationManager;
  private adapterRegistry: Map<
    IntegrationProvider,
    new (config: any) => IssueAdapter
  > = new Map();
  private adapterCache: Map<string, IssueAdapter> = new Map();

  private constructor() {
    // Initialize with built-in adapters
    this.registerAdapters();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): IntegrationManager {
    if (!IntegrationManager.instance) {
      IntegrationManager.instance = new IntegrationManager();
    }
    return IntegrationManager.instance;
  }

  /**
   * Register built-in adapters
   */
  private registerAdapters(): void {
    // Register Jira adapter
    this.registerAdapter("JIRA", JiraAdapter);

    // Register GitHub adapter
    this.registerAdapter("GITHUB", GitHubAdapter);

    // Register Azure DevOps adapter
    this.registerAdapter("AZURE_DEVOPS", AzureDevOpsAdapter);

    // Register Simple URL adapter
    this.registerAdapter("SIMPLE_URL", SimpleUrlAdapter);
  }

  /**
   * Register a new adapter type
   */
  registerAdapter(
    type: IntegrationProvider,
    adapterClass: new (config: any) => IssueAdapter
  ): void {
    this.adapterRegistry.set(type, adapterClass);
  }

  /**
   * Get adapter for a specific integration
   */
  async getAdapter(integrationId: string): Promise<IssueAdapter | null> {
    // Check cache first
    if (this.adapterCache.has(integrationId)) {
      return this.adapterCache.get(integrationId)!;
    }

    // Fetch integration from database
    const integration = await prisma.integration.findUnique({
      where: { id: parseInt(integrationId) },
      include: {
        userIntegrationAuths: {
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    if (integration.status !== "ACTIVE") {
      throw new Error(`Integration is not active: ${integrationId}`);
    }

    const AdapterClass = this.adapterRegistry.get(integration.provider);
    if (!AdapterClass) {
      throw new Error(
        `No adapter registered for integration provider: ${integration.provider}`
      );
    }

    // Create adapter instance with configuration
    const config = await this.buildAdapterConfig(integration);
    const adapter = new AdapterClass(config);

    const masterKey = getMasterKey();
    const authData: any = {
      type: this.mapAuthType(integration.authType),
    };

    // Handle API key or PAT authentication
    if ((integration.authType === "API_KEY" || integration.authType === "PERSONAL_ACCESS_TOKEN") && integration.credentials) {
      let credentials = integration.credentials as any;

      // Check if credentials are encrypted
      if (typeof credentials === "object" && "encrypted" in credentials) {
        // Decrypt credentials
        const decrypted = EncryptionService.decrypt(
          credentials.encrypted as string,
          masterKey
        );
        credentials = JSON.parse(decrypted);
      }

      // Add API key auth data from credentials
      if (credentials.email) authData.email = credentials.email;
      if (credentials.apiToken) authData.apiToken = credentials.apiToken;
      // For GitHub PAT authentication
      if (credentials.personalAccessToken) authData.apiKey = credentials.personalAccessToken;

      // Add baseUrl from settings
      if (integration.settings && typeof integration.settings === "object") {
        const settings = integration.settings as Record<string, any>;
        if (settings.baseUrl) authData.baseUrl = settings.baseUrl;
      }

      await adapter.authenticate(authData);
    } 
    // Handle OAuth authentication
    else if (integration.userIntegrationAuths.length > 0) {
      const auth = integration.userIntegrationAuths[0];
      authData.expiresAt = auth.tokenExpiresAt || undefined;

      // Decrypt sensitive fields
      if (auth.accessToken) {
        authData.accessToken = EncryptionService.decrypt(
          auth.accessToken,
          masterKey
        );
      }
      if (auth.refreshToken) {
        authData.refreshToken = EncryptionService.decrypt(
          auth.refreshToken,
          masterKey
        );
      }

      await adapter.authenticate(authData);
    }

    // Cache the adapter
    this.adapterCache.set(integrationId, adapter);

    return adapter;
  }

  /**
   * Map IntegrationAuthType enum to authentication type string
   */
  private mapAuthType(authType: string): "oauth" | "api_key" | "basic" {
    switch (authType) {
      case "OAUTH2":
        return "oauth";
      case "PERSONAL_ACCESS_TOKEN":
      case "API_KEY":
        return "api_key";
      default:
        return "basic";
    }
  }

  /**
   * Build adapter configuration from integration data
   */
  private async buildAdapterConfig(integration: Integration): Promise<any> {
    const config: any = {
      integrationId: integration.id,
      name: integration.name,
      provider: integration.provider,
    };

    // Add provider-specific settings
    if (integration.settings && typeof integration.settings === "object") {
      Object.assign(config, integration.settings);
    }

    return config;
  }

  /**
   * Clear adapter from cache
   */
  clearAdapter(integrationId: string): void {
    this.adapterCache.delete(integrationId);
  }

  /**
   * Clear all cached adapters
   */
  clearAllAdapters(): void {
    this.adapterCache.clear();
  }

  /**
   * Get all registered adapter types
   */
  getRegisteredTypes(): IntegrationProvider[] {
    return Array.from(this.adapterRegistry.keys());
  }

  /**
   * Check if adapter type is registered
   */
  isTypeRegistered(type: IntegrationProvider): boolean {
    return this.adapterRegistry.has(type);
  }

  /**
   * Get adapter capabilities for a specific integration
   */
  async getCapabilities(
    integrationId: string
  ): Promise<ReturnType<IssueAdapter["getCapabilities"]> | null> {
    const adapter = await this.getAdapter(integrationId);
    return adapter ? adapter.getCapabilities() : null;
  }

  /**
   * Validate integration configuration
   */
  async validateIntegration(
    integrationId: string
  ): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      const adapter = await this.getAdapter(integrationId);
      if (!adapter) {
        return { valid: false, errors: ["Adapter not found"] };
      }

      // Check authentication
      const isAuthenticated = await adapter.isAuthenticated();
      if (!isAuthenticated) {
        return { valid: false, errors: ["Authentication failed"] };
      }

      // Run adapter-specific validation if available
      if (adapter.validateConfiguration) {
        return await adapter.validateConfiguration();
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }
}

// Export singleton instance
export const integrationManager = IntegrationManager.getInstance();
