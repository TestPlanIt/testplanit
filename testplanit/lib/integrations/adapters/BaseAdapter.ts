import {
  IssueAdapter,
  IssueAdapterCapabilities,
  AuthenticationData,
  IssueData,
  CreateIssueData,
  UpdateIssueData,
  IssueSearchOptions,
  WebhookData,
  FieldMapping,
} from "./IssueAdapter";

/**
 * Base abstract class implementing common functionality for all issue tracking adapters
 */
export abstract class BaseAdapter implements IssueAdapter {
  protected config: any;
  protected authData?: AuthenticationData;
  protected authenticated: boolean = false;

  // Rate limiting configuration
  protected rateLimitDelay: number = 1000; // Default 1 second between requests
  protected lastRequestTime: number = 0;

  // Retry configuration
  protected maxRetries: number = 3;
  protected retryDelay: number = 1000;

  constructor(config: any) {
    this.config = config;
  }

  /**
   * Get the capabilities of this adapter
   */
  abstract getCapabilities(): IssueAdapterCapabilities;

  /**
   * Authenticate with the issue tracking system
   */
  async authenticate(authData: AuthenticationData): Promise<void> {
    this.authData = authData;
    await this.performAuthentication(authData);
    this.authenticated = true;
  }

  /**
   * Perform adapter-specific authentication
   */
  protected abstract performAuthentication(
    authData: AuthenticationData
  ): Promise<void>;

  /**
   * Check if the current authentication is valid
   */
  async isAuthenticated(): Promise<boolean> {
    if (!this.authenticated || !this.authData) {
      return false;
    }

    // Check if token has expired
    if (this.authData.expiresAt && this.authData.expiresAt < new Date()) {
      this.authenticated = false;
      return false;
    }

    // Perform adapter-specific validation if needed
    return this.validateAuthentication();
  }

  /**
   * Validate authentication (can be overridden by adapters)
   */
  protected async validateAuthentication(): Promise<boolean> {
    return true;
  }

  /**
   * Create a new issue
   */
  abstract createIssue(data: CreateIssueData): Promise<IssueData>;

  /**
   * Update an existing issue
   */
  abstract updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData>;

  /**
   * Get a single issue by ID
   */
  abstract getIssue(issueId: string): Promise<IssueData>;

  /**
   * Search for issues
   */
  abstract searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }>;

  /**
   * Link an issue to a test case
   */
  async linkToTestCase(
    issueId: string,
    testCaseId: string,
    metadata?: any
  ): Promise<void> {
    // Default implementation adds a comment to the issue
    const comment = `Linked to test case: ${testCaseId}${metadata ? "\nMetadata: " + JSON.stringify(metadata) : ""}`;
    await this.addComment(issueId, comment);
  }

  /**
   * Add a comment to an issue (should be implemented by adapters that support it)
   */
  protected async addComment(issueId: string, comment: string): Promise<void> {
    throw new Error("Adding comments is not supported by this adapter");
  }

  /**
   * Sync issue data from the external system
   */
  async syncIssue(issueId: string): Promise<IssueData> {
    return this.getIssue(issueId);
  }

  /**
   * Apply rate limiting
   */
  protected async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const delay = this.rateLimitDelay - timeSinceLastRequest;
      await this.sleep(delay);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Execute request with retry logic
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    retries: number = this.maxRetries
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i <= retries; i++) {
      try {
        await this.applyRateLimit();
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (i < retries) {
          const delay = this.retryDelay * Math.pow(2, i); // Exponential backoff
          console.warn(`Request failed, retrying in ${delay}ms...`, error);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error("Operation failed after retries");
  }

  /**
   * Sleep for specified milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make HTTP request with authentication headers
   */
  protected async makeRequest<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.authData) {
      throw new Error("Not authenticated");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    // Add authentication headers based on auth type
    switch (this.authData.type) {
      case "oauth":
        headers["Authorization"] = `Bearer ${this.authData.accessToken}`;
        break;
      case "api_key":
        // Some APIs use Authorization header with token prefix
        if (this.authData.apiKey) {
          if (this.config.provider === "AZURE_DEVOPS") {
            // Azure DevOps uses Basic auth with PAT
            const credentials = Buffer.from(
              `:${this.authData.apiKey}`
            ).toString("base64");
            headers["Authorization"] = `Basic ${credentials}`;
          } else if (this.config.provider === "GITHUB") {
            // GitHub uses token prefix
            headers["Authorization"] = `token ${this.authData.apiKey}`;
          } else {
            // Default to X-API-Key header
            headers["X-API-Key"] = this.authData.apiKey;
          }
        }
        break;
      case "basic":
        const credentials = Buffer.from(
          `${this.authData.username}:${this.authData.password}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
        break;
    }

    const response = await this.executeWithRetry(() =>
      fetch(url, {
        ...options,
        headers,
      })
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Build full URL from base URL and path
   */
  protected buildUrl(path: string): string {
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }

    // Ensure base URL doesn't end with slash and path starts with slash
    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;

    return `${cleanBaseUrl}${cleanPath}`;
  }

  /**
   * Default implementation for webhook registration (not supported by default)
   */
  async registerWebhook?(
    url: string,
    events: string[],
    secret?: string
  ): Promise<WebhookData> {
    throw new Error("Webhook registration is not supported by this adapter");
  }

  /**
   * Default implementation for webhook unregistration
   */
  async unregisterWebhook?(webhookId: string): Promise<void> {
    throw new Error("Webhook unregistration is not supported by this adapter");
  }

  /**
   * Default implementation for webhook processing
   */
  async processWebhook?(payload: any, signature?: string): Promise<void> {
    throw new Error("Webhook processing is not supported by this adapter");
  }

  /**
   * Get field mappings (can be overridden by adapters)
   */
  getFieldMappings?(): FieldMapping[] {
    return [];
  }

  /**
   * Validate configuration (can be overridden by adapters)
   */
  async validateConfiguration?(): Promise<{
    valid: boolean;
    errors?: string[];
  }> {
    const errors: string[] = [];

    if (!this.authData) {
      errors.push("No authentication data provided");
    }

    if (!this.config.baseUrl && !this.authData?.baseUrl) {
      errors.push("Base URL is required");
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
