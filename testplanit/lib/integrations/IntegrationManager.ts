import { rawDb } from "@/lib/rawDb";
import { EncryptionService, getMasterKey } from "@/utils/encryption";
import type { Integration, IntegrationProvider } from "~/zenstack/models";
import { AuthenticationService } from "./AuthenticationService";
import { AzureDevOpsAdapter } from "./adapters/AzureDevOpsAdapter";
import { GiteaAdapter } from "./adapters/GiteaAdapter";
import { GitHubAdapter } from "./adapters/GitHubAdapter";
import { GitLabAdapter } from "./adapters/GitLabAdapter";
import { IssueAdapter } from "./adapters/IssueAdapter";
import { JiraAdapter } from "./adapters/JiraAdapter";
import { MantisBTAdapter } from "./adapters/MantisBTAdapter";
import { RedmineAdapter } from "./adapters/RedmineAdapter";
import { SimpleUrlAdapter } from "./adapters/SimpleUrlAdapter";

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
  // Access-token expiry (epoch ms) for cached OAuth adapters. A cached adapter
  // holding an expired token must be rebuilt (so its token can refresh) rather
  // than served stale — otherwise reads start failing one hour after connect.
  private adapterCacheExpiry: Map<string, number> = new Map();

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
    this.registerAdapter("JIRA", JiraAdapter);
    this.registerAdapter("GITHUB", GitHubAdapter);
    this.registerAdapter("AZURE_DEVOPS", AzureDevOpsAdapter);
    this.registerAdapter("SIMPLE_URL", SimpleUrlAdapter);
    this.registerAdapter("GITLAB", GitLabAdapter);
    this.registerAdapter("GITEA", GiteaAdapter);
    this.registerAdapter("REDMINE", RedmineAdapter);
    this.registerAdapter("MANTISBT", MantisBTAdapter);
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
  async getAdapter(
    integrationId: string,
    dbClient?: typeof rawDb,
    userId?: string,
    options?: { allowInactive?: boolean }
  ): Promise<IssueAdapter | null> {
    // OAuth adapters carry a per-user token, so they must be cached per user
    const cacheKey = userId ? `${integrationId}:${userId}` : integrationId;

    // Check cache first — but never serve an OAuth adapter whose access token
    // has expired. Evict it so the rebuild below refreshes the token; otherwise
    // borrowed reads keep using the stale token and fail with a 401.
    if (this.adapterCache.has(cacheKey)) {
      const expiry = this.adapterCacheExpiry.get(cacheKey);
      if (expiry === undefined || expiry > Date.now()) {
        return this.adapterCache.get(cacheKey)!;
      }
      this.adapterCache.delete(cacheKey);
      this.adapterCacheExpiry.delete(cacheKey);
    }

    // Fetch integration from database (use provided client for multi-tenant support)
    const db = dbClient || rawDb;
    const integration = await db.integration.findUnique({
      where: { id: parseInt(integrationId) },
      include: {
        userIntegrationAuths: {
          where: { isActive: true, ...(userId ? { userId } : {}) },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    // OAuth 2.0 (3LO) integrations are intentionally inactive until a user
    // completes authorization — and the authorization flow itself needs the
    // adapter to build the authorize URL and to exchange the code for tokens.
    // Those two routes pass allowInactive so the setup handshake isn't blocked
    // by the very state it exists to resolve (otherwise an OAuth integration
    // can never become active). Every other caller still requires ACTIVE.
    if (integration.status !== "ACTIVE" && !options?.allowInactive) {
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
    if (
      (integration.authType === "API_KEY" ||
        integration.authType === "PERSONAL_ACCESS_TOKEN") &&
      integration.credentials
    ) {
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
      if (credentials.personalAccessToken)
        authData.apiKey = credentials.personalAccessToken;

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
      let accessToken = auth.accessToken
        ? EncryptionService.decrypt(auth.accessToken, masterKey)
        : undefined;
      let refreshToken = auth.refreshToken
        ? EncryptionService.decrypt(auth.refreshToken, masterKey)
        : undefined;

      // Transparently refresh an expired access token. Refresh on behalf of the
      // token's owner: read paths (issue hover/details) borrow a token without
      // passing a userId, so fall back to the owning user recorded on the auth
      // row. Without this, borrowed reads can never refresh and start failing an
      // hour after the admin connects. The new token is persisted so subsequent
      // requests skip the refresh.
      const isExpired =
        !!auth.tokenExpiresAt && auth.tokenExpiresAt < new Date();
      const ownerId = userId ?? auth.userId;
      if (isExpired && refreshToken && ownerId && adapter.refreshTokens) {
        try {
          const refreshed = await adapter.refreshTokens(refreshToken);
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken || refreshToken;
          authData.expiresAt = refreshed.expiresAt;
          await AuthenticationService.storeUserAuth(ownerId, integration.id, {
            accessToken: refreshed.accessToken,
            refreshToken,
            expiresAt: refreshed.expiresAt,
          });
        } catch (error) {
          // Leave the stale token in place; the downstream request will fail
          // with 401 and the UI surfaces the re-authorization prompt.
          console.error(
            `Failed to refresh OAuth token for integration ${integration.id}:`,
            error
          );
        }
      }

      authData.accessToken = accessToken;
      authData.refreshToken = refreshToken;

      await adapter.authenticate(authData);
    }

    // Cache the adapter — but never the transient ones built for the OAuth
    // setup handshake (allowInactive). Those are constructed before a user
    // token exists, so they are unauthenticated and have no cloud ID. Caching
    // one under the shared integration key poisons later real requests on this
    // pod with "Cloud ID not set" until it restarts — and because each pod has
    // its own cache (and the callback's clearAdapter only clears the pod it
    // runs on), other replicas would keep serving the stale adapter. The auth
    // and callback routes each use their adapter once, so skipping the cache
    // costs nothing.
    if (!options?.allowInactive) {
      this.adapterCache.set(cacheKey, adapter);
      // Track the access-token expiry so the cache hit above can evict and
      // rebuild once it lapses (OAuth only; API-key adapters have no expiry).
      if (authData.expiresAt) {
        this.adapterCacheExpiry.set(
          cacheKey,
          new Date(authData.expiresAt).getTime()
        );
      }
    }

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

    // OAuth integrations store their client credentials per-integration so that
    // self-hosted instances (Gitea/Forgejo, self-managed GitLab, GHES) can each
    // register their own OAuth app. Decrypt them and pass them to the adapter
    // along with the redirect URI for the generic OAuth callback route.
    if (integration.authType === "OAUTH2" && integration.credentials) {
      let credentials = integration.credentials as any;
      if (typeof credentials === "object" && "encrypted" in credentials) {
        const decrypted = EncryptionService.decrypt(
          credentials.encrypted as string,
          getMasterKey()
        );
        credentials = JSON.parse(decrypted);
      }
      if (credentials.clientId) config.clientId = credentials.clientId;
      if (credentials.clientSecret)
        config.clientSecret = credentials.clientSecret;
      config.redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/oauth/${integration.provider.toLowerCase()}/callback`;
    }

    return config;
  }

  /**
   * Clear adapter from cache
   */
  clearAdapter(integrationId: string): void {
    // Remove the shared entry plus any per-user OAuth variants (`<id>:<userId>`)
    for (const key of this.adapterCache.keys()) {
      if (key === integrationId || key.startsWith(`${integrationId}:`)) {
        this.adapterCache.delete(key);
        this.adapterCacheExpiry.delete(key);
      }
    }
  }

  /**
   * Clear all cached adapters
   */
  clearAllAdapters(): void {
    this.adapterCache.clear();
    this.adapterCacheExpiry.clear();
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
