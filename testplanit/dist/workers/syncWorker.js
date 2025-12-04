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

// workers/syncWorker.ts
var syncWorker_exports = {};
__export(syncWorker_exports, {
  default: () => syncWorker_default
});
module.exports = __toCommonJS(syncWorker_exports);
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

// lib/queueNames.ts
var SYNC_QUEUE_NAME = "issue-sync";

// lib/queues.ts
var import_bullmq = require("bullmq");
var _syncQueue = null;
function getSyncQueue() {
  if (_syncQueue) return _syncQueue;
  if (!valkey_default) {
    console.warn(`Valkey connection not available, Queue "${SYNC_QUEUE_NAME}" not initialized.`);
    return null;
  }
  _syncQueue = new import_bullmq.Queue(SYNC_QUEUE_NAME, {
    connection: valkey_default,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5e3
      },
      removeOnComplete: {
        age: 3600 * 24 * 3,
        count: 500
      },
      removeOnFail: {
        age: 3600 * 24 * 7
      }
    }
  });
  console.log(`Queue "${SYNC_QUEUE_NAME}" initialized.`);
  _syncQueue.on("error", (error) => {
    console.error(`Queue ${SYNC_QUEUE_NAME} error:`, error);
  });
  return _syncQueue;
}

// lib/integrations/cache/IssueCache.ts
var IssueCache = class {
  valkey;
  // Valkey connection instance
  defaultTTL = 3600;
  // 1 hour default TTL
  constructor() {
    this.valkey = valkey_default ? valkey_default.duplicate() : null;
  }
  getCacheKey(integrationId, externalId) {
    return `issue:${integrationId}:${externalId}`;
  }
  getBulkCacheKey(integrationId, projectId) {
    return projectId ? `issues:${integrationId}:project:${projectId}` : `issues:${integrationId}:all`;
  }
  getMetadataCacheKey(integrationId) {
    return `issue-metadata:${integrationId}`;
  }
  getProjectCacheKey(integrationId) {
    return `projects:${integrationId}`;
  }
  async get(integrationId, externalId) {
    if (!this.valkey) return null;
    const key = this.getCacheKey(integrationId, externalId);
    const cached = await this.valkey.get(key);
    if (!cached) {
      return null;
    }
    try {
      const data = JSON.parse(cached);
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        cachedAt: new Date(data.cachedAt)
      };
    } catch (error) {
      console.error("Failed to parse cached issue:", error);
      await this.valkey.del(key);
      return null;
    }
  }
  async set(integrationId, externalId, issue, ttl) {
    if (!this.valkey) return;
    const key = this.getCacheKey(integrationId, externalId);
    const cachedIssue = {
      ...issue,
      integrationId,
      cachedAt: /* @__PURE__ */ new Date()
    };
    const value = JSON.stringify(cachedIssue);
    const cacheTTL = ttl ?? this.defaultTTL;
    await this.valkey.setex(key, cacheTTL, value);
  }
  async getBulk(integrationId, projectId) {
    if (!this.valkey) return [];
    const key = this.getBulkCacheKey(integrationId, projectId);
    const cached = await this.valkey.get(key);
    if (!cached) {
      return [];
    }
    try {
      const data = JSON.parse(cached);
      return data.map((item) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        cachedAt: new Date(item.cachedAt)
      }));
    } catch (error) {
      console.error("Failed to parse cached issues:", error);
      await this.valkey.del(key);
      return [];
    }
  }
  async setBulk(integrationId, issues, projectId, ttl) {
    if (!this.valkey) return;
    const key = this.getBulkCacheKey(integrationId, projectId);
    const cachedIssues = issues.map((issue) => ({
      ...issue,
      integrationId,
      cachedAt: /* @__PURE__ */ new Date()
    }));
    const value = JSON.stringify(cachedIssues);
    const cacheTTL = ttl ?? this.defaultTTL;
    await this.valkey.setex(key, cacheTTL, value);
    const pipeline = this.valkey.pipeline();
    for (const issue of issues) {
      const issueKey = this.getCacheKey(integrationId, issue.id);
      const cachedIssue = {
        ...issue,
        integrationId,
        cachedAt: /* @__PURE__ */ new Date()
      };
      pipeline.setex(issueKey, cacheTTL, JSON.stringify(cachedIssue));
    }
    await pipeline.exec();
  }
  async invalidate(integrationId, externalId) {
    if (!this.valkey) return;
    if (externalId) {
      const key = this.getCacheKey(integrationId, externalId);
      await this.valkey.del(key);
    } else {
      const stream = this.valkey.scanStream({
        match: `issue:${integrationId}:*`,
        count: 100
      });
      const pipeline = this.valkey.pipeline();
      stream.on("data", (keys) => {
        if (keys.length) {
          keys.forEach((key) => pipeline.del(key));
        }
      });
      stream.on("end", async () => {
        await pipeline.exec();
      });
      const bulkStream = this.valkey.scanStream({
        match: `issues:${integrationId}:*`,
        count: 100
      });
      const bulkPipeline = this.valkey.pipeline();
      bulkStream.on("data", (keys) => {
        if (keys.length) {
          keys.forEach((key) => bulkPipeline.del(key));
        }
      });
      bulkStream.on("end", async () => {
        await bulkPipeline.exec();
      });
    }
  }
  async invalidateProject(integrationId, projectId) {
    if (!this.valkey) return;
    const key = this.getBulkCacheKey(integrationId, projectId);
    await this.valkey.del(key);
  }
  async getMetadata(integrationId) {
    if (!this.valkey) return null;
    const key = this.getMetadataCacheKey(integrationId);
    const cached = await this.valkey.get(key);
    if (!cached) {
      return null;
    }
    try {
      return JSON.parse(cached);
    } catch (error) {
      console.error("Failed to parse cached metadata:", error);
      await this.valkey.del(key);
      return null;
    }
  }
  async setMetadata(integrationId, metadata, ttl = 7200) {
    if (!this.valkey) return;
    const key = this.getMetadataCacheKey(integrationId);
    const value = JSON.stringify(metadata);
    await this.valkey.setex(key, ttl, value);
  }
  async getProjects(integrationId) {
    if (!this.valkey) return null;
    const key = this.getProjectCacheKey(integrationId);
    const cached = await this.valkey.get(key);
    if (!cached) {
      return null;
    }
    try {
      return JSON.parse(cached);
    } catch (error) {
      console.error("Failed to parse cached projects:", error);
      await this.valkey.del(key);
      return null;
    }
  }
  async setProjects(integrationId, projects, ttl = 86400) {
    if (!this.valkey) return;
    const key = this.getProjectCacheKey(integrationId);
    const value = JSON.stringify(projects);
    await this.valkey.setex(key, ttl, value);
  }
  async getCacheTTL(integrationId, externalId) {
    if (!this.valkey) return -1;
    const key = this.getCacheKey(integrationId, externalId);
    return await this.valkey.ttl(key);
  }
  async warmCache(integrationId, fetchFn, projectId) {
    try {
      const issues = await fetchFn();
      await this.setBulk(integrationId, issues, projectId);
    } catch (error) {
      console.error("Failed to warm cache:", error);
    }
  }
  async close() {
    if (this.valkey) {
      this.valkey.disconnect();
    }
  }
};
var issueCache = new IssueCache();

// lib/integrations/IntegrationManager.ts
init_prismaBase();

// lib/integrations/adapters/BaseAdapter.ts
var BaseAdapter = class {
  config;
  authData;
  authenticated = false;
  // Rate limiting configuration
  rateLimitDelay = 1e3;
  // Default 1 second between requests
  lastRequestTime = 0;
  // Retry configuration
  maxRetries = 3;
  retryDelay = 1e3;
  constructor(config) {
    this.config = config;
  }
  /**
   * Authenticate with the issue tracking system
   */
  async authenticate(authData) {
    this.authData = authData;
    await this.performAuthentication(authData);
    this.authenticated = true;
  }
  /**
   * Check if the current authentication is valid
   */
  async isAuthenticated() {
    if (!this.authenticated || !this.authData) {
      return false;
    }
    if (this.authData.expiresAt && this.authData.expiresAt < /* @__PURE__ */ new Date()) {
      this.authenticated = false;
      return false;
    }
    return this.validateAuthentication();
  }
  /**
   * Validate authentication (can be overridden by adapters)
   */
  async validateAuthentication() {
    return true;
  }
  /**
   * Link an issue to a test case
   */
  async linkToTestCase(issueId, testCaseId, metadata) {
    const comment = `Linked to test case: ${testCaseId}${metadata ? "\nMetadata: " + JSON.stringify(metadata) : ""}`;
    await this.addComment(issueId, comment);
  }
  /**
   * Add a comment to an issue (should be implemented by adapters that support it)
   */
  async addComment(issueId, comment) {
    throw new Error("Adding comments is not supported by this adapter");
  }
  /**
   * Sync issue data from the external system
   */
  async syncIssue(issueId) {
    return this.getIssue(issueId);
  }
  /**
   * Apply rate limiting
   */
  async applyRateLimit() {
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
  async executeWithRetry(operation, retries = this.maxRetries) {
    let lastError;
    for (let i = 0; i <= retries; i++) {
      try {
        await this.applyRateLimit();
        return await operation();
      } catch (error) {
        lastError = error;
        if (i < retries) {
          const delay = this.retryDelay * Math.pow(2, i);
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
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /**
   * Make HTTP request with authentication headers
   */
  async makeRequest(url, options = {}) {
    if (!this.authData) {
      throw new Error("Not authenticated");
    }
    const headers = {
      "Content-Type": "application/json",
      ...options.headers || {}
    };
    switch (this.authData.type) {
      case "oauth":
        headers["Authorization"] = `Bearer ${this.authData.accessToken}`;
        break;
      case "api_key":
        if (this.authData.apiKey) {
          if (this.config.provider === "AZURE_DEVOPS") {
            const credentials2 = Buffer.from(
              `:${this.authData.apiKey}`
            ).toString("base64");
            headers["Authorization"] = `Basic ${credentials2}`;
          } else if (this.config.provider === "GITHUB") {
            headers["Authorization"] = `token ${this.authData.apiKey}`;
          } else {
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
    const response = await this.executeWithRetry(
      () => fetch(url, {
        ...options,
        headers
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
  buildUrl(path) {
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }
    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${cleanBaseUrl}${cleanPath}`;
  }
  /**
   * Default implementation for webhook registration (not supported by default)
   */
  async registerWebhook(url, events, secret) {
    throw new Error("Webhook registration is not supported by this adapter");
  }
  /**
   * Default implementation for webhook unregistration
   */
  async unregisterWebhook(webhookId) {
    throw new Error("Webhook unregistration is not supported by this adapter");
  }
  /**
   * Default implementation for webhook processing
   */
  async processWebhook(payload, signature) {
    throw new Error("Webhook processing is not supported by this adapter");
  }
  /**
   * Get field mappings (can be overridden by adapters)
   */
  getFieldMappings() {
    return [];
  }
  /**
   * Validate configuration (can be overridden by adapters)
   */
  async validateConfiguration() {
    const errors = [];
    if (!this.authData) {
      errors.push("No authentication data provided");
    }
    if (!this.config.baseUrl && !this.authData?.baseUrl) {
      errors.push("Base URL is required");
    }
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : void 0
    };
  }
};

// lib/integrations/adapters/JiraAdapter.ts
var JiraAdapter = class extends BaseAdapter {
  supportsOAuth = true;
  clientId;
  clientSecret;
  redirectUri;
  cloudId;
  apiEmail;
  apiToken;
  baseUrl;
  constructor(config) {
    super(config);
    this.clientId = process.env.JIRA_CLIENT_ID || "";
    this.clientSecret = process.env.JIRA_CLIENT_SECRET || "";
    this.redirectUri = process.env.JIRA_REDIRECT_URI || "";
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }
  getCapabilities() {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: true,
      customFields: true,
      attachments: true
    };
  }
  async performAuthentication(authData) {
    if (authData.type === "api_key") {
      if (!authData.email || !authData.apiToken || !authData.baseUrl) {
        throw new Error(
          "API key authentication requires email, apiToken, and baseUrl"
        );
      }
      this.apiEmail = authData.email;
      this.apiToken = authData.apiToken;
      this.baseUrl = authData.baseUrl;
      const response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.apiEmail}:${this.apiToken}`).toString("base64")}`,
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        throw new Error(
          `Jira API authentication failed: ${response.statusText}`
        );
      }
    } else if (authData.type === "oauth") {
      if (!this.clientId || !this.clientSecret || !this.redirectUri) {
        throw new Error(
          "Jira OAuth configuration is incomplete. Please check environment variables."
        );
      }
      if (!this.cloudId) {
        const resources = await this.getAccessibleResources(
          authData.accessToken
        );
        if (resources.length === 0) {
          throw new Error("No accessible Jira resources found");
        }
        this.cloudId = resources[0].id;
      }
    } else {
      throw new Error(
        "Jira adapter only supports OAuth and API key authentication"
      );
    }
  }
  /**
   * Get available projects
   */
  async getProjects() {
    if (this.apiEmail && this.apiToken && this.baseUrl) {
      const response = await fetch(
        `${this.baseUrl}/rest/api/3/project/search`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.apiEmail}:${this.apiToken}`).toString("base64")}`,
            Accept: "application/json"
          }
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.statusText}`);
      }
      const data = await response.json();
      return (data.values || []).map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name
      }));
    } else if (this.authData?.accessToken && this.cloudId) {
      const response = await this.makeRequest(
        `https://api.atlassian.com/ex/jira/${this.cloudId}/rest/api/3/project/search`
      );
      return (response.values || []).map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name
      }));
    } else {
      throw new Error("Not authenticated");
    }
  }
  /**
   * Get OAuth authorization URL
   */
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: this.clientId,
      scope: "read:jira-work write:jira-work read:jira-user offline_access",
      redirect_uri: this.redirectUri,
      state,
      response_type: "code",
      prompt: "consent"
    });
    return `https://auth.atlassian.com/authorize?${params.toString()}`;
  }
  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code) {
    const response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for tokens: ${error}`);
    }
    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1e3) : void 0
    };
  }
  /**
   * Refresh OAuth tokens
   */
  async refreshTokens(refreshToken) {
    const response = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh tokens: ${error}`);
    }
    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1e3) : void 0
    };
  }
  /**
   * Get accessible Jira resources
   */
  async getAccessibleResources(accessToken) {
    const response = await fetch(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );
    if (!response.ok) {
      throw new Error("Failed to get accessible resources");
    }
    return response.json();
  }
  buildUrl(path) {
    if (this.apiEmail && this.apiToken && this.baseUrl) {
      return `${this.baseUrl}${path}`;
    }
    if (!this.cloudId) {
      throw new Error("Cloud ID not set. Please authenticate first.");
    }
    return `https://api.atlassian.com/ex/jira/${this.cloudId}${path}`;
  }
  /**
   * Override makeRequest to handle Jira's API key authentication
   */
  async makeRequest(url, options = {}) {
    if (this.apiEmail && this.apiToken) {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers || {}
      };
      const credentials = Buffer.from(
        `${this.apiEmail}:${this.apiToken}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${credentials}`;
      const response = await fetch(url, {
        ...options,
        headers
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      return response.json();
    }
    return super.makeRequest(url, options);
  }
  async createIssue(data) {
    const projectField = isNaN(Number(data.projectId)) ? { key: data.projectId } : { id: data.projectId };
    let descriptionField;
    if (data.description) {
      if (typeof data.description === "object" && data.description && "type" in data.description && data.description.type === "doc") {
        descriptionField = this.tiptapToAdf(data.description);
      } else if (typeof data.description === "string" && data.description.includes("<") && data.description.includes(">")) {
        descriptionField = this.htmlToAdf(data.description);
      } else if (typeof data.description === "string") {
        descriptionField = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: data.description
                }
              ]
            }
          ]
        };
      }
    } else {
      descriptionField = null;
    }
    const { reporter, ...otherCustomFields } = data.customFields || {};
    const jiraPayload = {
      fields: {
        project: projectField,
        summary: data.title,
        description: descriptionField,
        issuetype: { id: data.issueType || "10001" },
        // Default to Task
        priority: data.priority ? { id: data.priority } : void 0,
        assignee: data.assigneeId ? { id: data.assigneeId } : void 0,
        reporter: reporter || void 0,
        // Reporter is a system field, not custom
        labels: data.labels || [],
        ...otherCustomFields
      }
    };
    try {
      const response = await this.makeRequest(
        this.buildUrl("/rest/api/3/issue"),
        {
          method: "POST",
          body: JSON.stringify(jiraPayload)
        }
      );
      if (response.key) {
        const fullIssue = await this.getIssue(response.key);
        return fullIssue;
      }
      throw new Error("Failed to create issue - no key returned");
    } catch (error) {
      console.error("[JiraAdapter] Failed to create issue:", error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to create issue in Jira");
    }
  }
  async updateIssue(issueId, data) {
    const updatePayload = { fields: {} };
    if (data.title !== void 0) {
      updatePayload.fields.summary = data.title;
    }
    if (data.description !== void 0) {
      if (typeof data.description === "object" && data.description && "type" in data.description && data.description.type === "doc") {
        updatePayload.fields.description = this.tiptapToAdf(data.description);
      } else if (typeof data.description === "string" && data.description.includes("<") && data.description.includes(">")) {
        updatePayload.fields.description = this.htmlToAdf(data.description);
      } else if (typeof data.description === "string") {
        updatePayload.fields.description = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: data.description
                }
              ]
            }
          ]
        };
      }
    }
    if (data.priority !== void 0) {
      updatePayload.fields.priority = { id: data.priority };
    }
    if (data.assigneeId !== void 0) {
      updatePayload.fields.assignee = { id: data.assigneeId };
    }
    if (data.labels !== void 0) {
      updatePayload.fields.labels = data.labels;
    }
    if (data.customFields) {
      Object.assign(updatePayload.fields, data.customFields);
    }
    await this.makeRequest(this.buildUrl(`/rest/api/3/issue/${issueId}`), {
      method: "PUT",
      body: JSON.stringify(updatePayload)
    });
    if (data.status !== void 0) {
      await this.transitionIssue(issueId, data.status);
    }
    return this.getIssue(issueId);
  }
  async getIssue(issueId) {
    const params = new URLSearchParams({
      fields: "summary,description,status,priority,issuetype,assignee,reporter,labels,created,updated",
      expand: "names,schema"
    });
    const response = await this.makeRequest(
      this.buildUrl(`/rest/api/3/issue/${issueId}?${params.toString()}`)
    );
    return this.mapJiraIssue(response);
  }
  async searchIssues(options) {
    const jql = [];
    if (options.projectId) {
      jql.push(`project = ${options.projectId}`);
    }
    if (options.query) {
      const query = options.query.trim();
      const jqlConditions = [];
      if (/^[A-Za-z]+-\d+$/.test(query)) {
        jqlConditions.push(`key = "${query.toUpperCase()}"`);
      }
      jqlConditions.push(`summary ~ "${query}*"`);
      jqlConditions.push(`description ~ "${query}*"`);
      jql.push(`(${jqlConditions.join(" OR ")})`);
    }
    if (options.status && options.status.length > 0) {
      jql.push(`status IN (${options.status.map((s) => `"${s}"`).join(", ")})`);
    }
    if (options.assignee) {
      jql.push(`assignee = ${options.assignee}`);
    }
    if (options.labels && options.labels.length > 0) {
      jql.push(`labels IN (${options.labels.map((l) => `"${l}"`).join(", ")})`);
    }
    let jqlString;
    if (jql.length > 0) {
      jqlString = jql.join(" AND ") + " ORDER BY created DESC";
    } else if (options.fullSync) {
      jqlString = "created >= -365d ORDER BY created DESC";
    } else {
      jqlString = "created >= -30d ORDER BY created DESC";
    }
    const params = new URLSearchParams({
      jql: jqlString,
      startAt: (options.offset || 0).toString(),
      maxResults: (options.limit || 50).toString(),
      fields: "summary,description,status,priority,issuetype,assignee,reporter,labels,created,updated",
      expand: "names,schema"
    });
    const searchUrl = this.buildUrl(
      `/rest/api/3/search/jql?${params.toString()}`
    );
    const response = await this.makeRequest(searchUrl);
    return {
      issues: response.issues.map((issue) => this.mapJiraIssue(issue)),
      total: response.total,
      hasMore: response.startAt + response.issues.length < response.total
    };
  }
  async addComment(issueId, comment) {
    await this.makeRequest(
      this.buildUrl(`/rest/api/3/issue/${issueId}/comment`),
      {
        method: "POST",
        body: JSON.stringify({
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: comment
                  }
                ]
              }
            ]
          }
        })
      }
    );
  }
  async transitionIssue(issueId, targetStatus) {
    const transitions = await this.makeRequest(
      this.buildUrl(`/rest/api/3/issue/${issueId}/transitions`)
    );
    const transition = transitions.transitions.find(
      (t) => t.to.name.toLowerCase() === targetStatus.toLowerCase()
    );
    if (!transition) {
      throw new Error(`No transition available to status: ${targetStatus}`);
    }
    await this.makeRequest(
      this.buildUrl(`/rest/api/3/issue/${issueId}/transitions`),
      {
        method: "POST",
        body: JSON.stringify({
          transition: { id: transition.id }
        })
      }
    );
  }
  mapJiraIssue(jiraIssue) {
    if (!jiraIssue) {
      throw new Error("Invalid Jira issue: issue object is null or undefined");
    }
    if (!jiraIssue.fields) {
      throw new Error(
        `Invalid Jira issue ${jiraIssue.key || jiraIssue.id}: missing fields object`
      );
    }
    const fields = jiraIssue.fields;
    if (!fields.summary) {
      throw new Error(
        `Invalid Jira issue ${jiraIssue.key || jiraIssue.id}: missing summary field`
      );
    }
    if (!fields.status) {
      throw new Error(
        `Invalid Jira issue ${jiraIssue.key || jiraIssue.id}: missing status field`
      );
    }
    return {
      id: jiraIssue.id,
      key: jiraIssue.key,
      title: fields.summary,
      description: this.extractDescription(fields.description),
      status: fields.status.name,
      priority: fields.priority?.name,
      issueType: fields.issuetype ? {
        id: fields.issuetype.id,
        name: fields.issuetype.name,
        iconUrl: fields.issuetype.iconUrl
      } : void 0,
      assignee: fields.assignee ? {
        id: fields.assignee.accountId,
        name: fields.assignee.displayName,
        email: fields.assignee.emailAddress
      } : void 0,
      reporter: fields.reporter ? {
        id: fields.reporter.accountId,
        name: fields.reporter.displayName,
        email: fields.reporter.emailAddress
      } : void 0,
      labels: fields.labels || [],
      customFields: this.extractCustomFields(fields),
      createdAt: new Date(fields.created),
      updatedAt: new Date(fields.updated),
      url: `${jiraIssue.self.split("/rest/")[0]}/browse/${jiraIssue.key}`
    };
  }
  extractDescription(description) {
    if (!description) return void 0;
    if (description.type === "doc" && description.content) {
      return this.adfToHtml(description.content);
    }
    return description.toString();
  }
  adfToHtml(content) {
    let html = "";
    for (const node of content) {
      html += this.convertAdfNodeToHtml(node);
    }
    return html.trim();
  }
  convertAdfNodeToHtml(node) {
    if (!node) return "";
    switch (node.type) {
      case "paragraph":
        let paragraphContent = "";
        if (node.content) {
          paragraphContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        return `<p>${paragraphContent}</p>`;
      case "heading":
        let headingContent = "";
        if (node.content) {
          headingContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        const level = Math.min(node.attrs?.level || 1, 6);
        return `<h${level}>${headingContent}</h${level}>`;
      case "bulletList":
        let bulletListContent = "";
        if (node.content) {
          bulletListContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        return `<ul>${bulletListContent}</ul>`;
      case "orderedList":
        let orderedListContent = "";
        if (node.content) {
          orderedListContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        return `<ol>${orderedListContent}</ol>`;
      case "listItem":
        let itemContent = "";
        if (node.content) {
          itemContent = node.content.map((child) => {
            if (child.type === "paragraph") {
              return child.content ? child.content.map(
                (grandChild) => this.convertAdfNodeToHtml(grandChild)
              ).join("") : "";
            }
            return this.convertAdfNodeToHtml(child);
          }).join("");
        }
        return `<li>${itemContent}</li>`;
      case "blockquote":
        let quoteContent = "";
        if (node.content) {
          quoteContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        return `<blockquote>${quoteContent}</blockquote>`;
      case "codeBlock":
        let codeContent = "";
        if (node.content) {
          codeContent = node.content.map((child) => {
            if (child.type === "text") {
              return child.text || "";
            }
            return this.convertAdfNodeToHtml(child);
          }).join("");
        }
        const language = node.attrs?.language || "";
        return `<pre><code${language ? ` class="language-${language}"` : ""}>${this.escapeHtml(codeContent)}</code></pre>`;
      case "text":
        let textContent = node.text || "";
        textContent = this.escapeHtml(textContent);
        if (node.marks && Array.isArray(node.marks)) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case "strong":
                textContent = `<strong>${textContent}</strong>`;
                break;
              case "em":
                textContent = `<em>${textContent}</em>`;
                break;
              case "underline":
                textContent = `<u>${textContent}</u>`;
                break;
              case "strike":
                textContent = `<s>${textContent}</s>`;
                break;
              case "code":
                textContent = `<code>${textContent}</code>`;
                break;
              case "link":
                const href = this.escapeHtml(mark.attrs?.href || "");
                textContent = `<a href="${href}" target="_blank" rel="noopener noreferrer">${textContent}</a>`;
                break;
            }
          }
        }
        return textContent;
      case "hardBreak":
        return "<br>";
      case "rule":
        return "<hr>";
      case "mention":
        const mentionText = node.attrs?.text || node.attrs?.displayName || "@user";
        return `<span class="mention">${this.escapeHtml(mentionText)}</span>`;
      case "emoji":
        const emojiText = node.attrs?.shortName || node.attrs?.text || "";
        return this.escapeHtml(emojiText);
      case "table":
        let tableContent = "";
        if (node.content) {
          tableContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        return `<table>${tableContent}</table>`;
      case "tableRow":
        let rowContent = "";
        if (node.content) {
          rowContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        return `<tr>${rowContent}</tr>`;
      case "tableCell":
      case "tableHeader":
        let cellContent = "";
        if (node.content) {
          cellContent = node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        const tag = node.type === "tableHeader" ? "th" : "td";
        return `<${tag}>${cellContent}</${tag}>`;
      default:
        if (node.content) {
          return node.content.map((child) => this.convertAdfNodeToHtml(child)).join("");
        }
        if (node.text) {
          return this.escapeHtml(node.text);
        }
        return "";
    }
  }
  escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
  async getIssueTypes(projectKey) {
    try {
      const projectUrl = this.buildUrl(`/rest/api/3/project/${projectKey}`);
      const project = await this.makeRequest(projectUrl);
      const issueTypes = project.issueTypes || [];
      return issueTypes.map((type) => ({
        id: type.id,
        name: type.name
      }));
    } catch (error) {
      console.error("Failed to fetch issue types:", error);
      try {
        const allTypesUrl = this.buildUrl(`/rest/api/3/issuetype`);
        const allTypes = await this.makeRequest(allTypesUrl);
        return allTypes.filter((type) => !type.subtask).map((type) => ({
          id: type.id,
          name: type.name
        }));
      } catch (fallbackError) {
        console.error("Failed to fetch issue types (fallback):", fallbackError);
        throw new Error("Failed to fetch issue types from Jira");
      }
    }
  }
  async getIssueTypeFields(projectKey, issueTypeId) {
    try {
      const url = this.buildUrl(
        `/rest/api/3/issue/createmeta?projectKeys=${projectKey}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`
      );
      const metadata = await this.makeRequest(url);
      const project = metadata.projects?.[0];
      const issueType = project?.issuetypes?.[0];
      if (!issueType?.fields) {
        return [];
      }
      const fields = Object.entries(issueType.fields).filter(([key]) => {
        const excludedFields = [
          "summary",
          "description",
          "issuetype",
          "project",
          "reporter"
        ];
        return !excludedFields.includes(key);
      }).map(([key, field]) => ({
        key,
        name: field.name,
        required: field.required || false,
        schema: field.schema,
        allowedValues: field.allowedValues,
        hasDefaultValue: field.hasDefaultValue || false,
        defaultValue: field.defaultValue,
        autoCompleteUrl: field.autoCompleteUrl
      }));
      return fields;
    } catch (error) {
      console.error("Failed to fetch issue type fields:", error);
      return [];
    }
  }
  extractCustomFields(fields) {
    const customFields = {};
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith("customfield_") && value !== null) {
        customFields[key] = value;
      }
    }
    return customFields;
  }
  tiptapToAdf(tiptapJson) {
    const doc = {
      type: "doc",
      version: 1,
      content: []
    };
    if (!tiptapJson || !tiptapJson.content) {
      return doc;
    }
    tiptapJson.content.forEach((node) => {
      const adfNode = this.convertTiptapNodeToAdf(node);
      if (adfNode) {
        doc.content.push(adfNode);
      }
    });
    if (doc.content.length === 0) {
      doc.content.push({
        type: "paragraph",
        content: []
      });
    }
    return doc;
  }
  convertTiptapNodeToAdf(node) {
    if (!node) return null;
    switch (node.type) {
      case "paragraph":
        return {
          type: "paragraph",
          content: this.convertTiptapMarks(node.content || [])
        };
      case "heading":
        return {
          type: "heading",
          attrs: {
            level: node.attrs?.level || 1
          },
          content: this.convertTiptapMarks(node.content || [])
        };
      case "bulletList":
        return {
          type: "bulletList",
          content: (node.content || []).map((item) => this.convertTiptapNodeToAdf(item)).filter(Boolean)
        };
      case "orderedList":
        return {
          type: "orderedList",
          content: (node.content || []).map((item) => this.convertTiptapNodeToAdf(item)).filter(Boolean)
        };
      case "listItem":
        return {
          type: "listItem",
          content: (node.content || []).map((item) => this.convertTiptapNodeToAdf(item)).filter(Boolean)
        };
      case "blockquote":
        return {
          type: "blockquote",
          content: (node.content || []).map((item) => this.convertTiptapNodeToAdf(item)).filter(Boolean)
        };
      case "codeBlock":
        return {
          type: "codeBlock",
          attrs: {
            language: node.attrs?.language || null
          },
          content: [
            {
              type: "text",
              text: node.content?.map((c) => c.text || "").join("") || ""
            }
          ]
        };
      case "horizontalRule":
        return {
          type: "rule"
        };
      case "hardBreak":
        return {
          type: "hardBreak"
        };
      case "text":
        return null;
      default:
        if (node.content) {
          return {
            type: "paragraph",
            content: this.convertTiptapMarks(node.content)
          };
        }
        return null;
    }
  }
  convertTiptapMarks(content) {
    if (!content || !Array.isArray(content)) return [];
    const result = [];
    content.forEach((node) => {
      if (node.type === "text") {
        const textNode = {
          type: "text",
          text: node.text || ""
        };
        if (node.marks && Array.isArray(node.marks)) {
          const adfMarks = [];
          node.marks.forEach((mark) => {
            switch (mark.type) {
              case "bold":
              case "strong":
                adfMarks.push({ type: "strong" });
                break;
              case "italic":
              case "em":
                adfMarks.push({ type: "em" });
                break;
              case "underline":
                adfMarks.push({ type: "underline" });
                break;
              case "strike":
                adfMarks.push({ type: "strike" });
                break;
              case "code":
                adfMarks.push({ type: "code" });
                break;
              case "link":
                adfMarks.push({
                  type: "link",
                  attrs: {
                    href: mark.attrs?.href || ""
                  }
                });
                break;
            }
          });
          if (adfMarks.length > 0) {
            textNode.marks = adfMarks;
          }
        }
        result.push(textNode);
      } else {
        const converted = this.convertTiptapNodeToAdf(node);
        if (converted) {
          result.push(converted);
        }
      }
    });
    return result;
  }
  htmlToAdf(html) {
    const doc = {
      type: "doc",
      version: 1,
      content: []
    };
    const paragraphs = html.split(/<\/p>|<\/h[1-6]>|<\/li>|<\/blockquote>/);
    paragraphs.forEach((paragraph) => {
      if (!paragraph.trim()) return;
      const headingMatch = paragraph.match(/<h([1-6])>/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1]);
        const text = paragraph.replace(/<[^>]*>/g, "").trim();
        if (text) {
          doc.content.push({
            type: "heading",
            attrs: { level: Math.min(level, 6) },
            content: [
              {
                type: "text",
                text
              }
            ]
          });
        }
        return;
      }
      if (paragraph.includes("<ul>") || paragraph.includes("<ol>")) {
        const listType = paragraph.includes("<ul>") ? "bulletList" : "orderedList";
        const listItems = paragraph.split(/<\/li>/);
        const listContent = [];
        listItems.forEach((item) => {
          const itemText = item.replace(/<[^>]*>/g, "").trim();
          if (itemText) {
            listContent.push({
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: itemText
                    }
                  ]
                }
              ]
            });
          }
        });
        if (listContent.length > 0) {
          doc.content.push({
            type: listType,
            content: listContent
          });
        }
        return;
      }
      if (paragraph.includes("<blockquote>")) {
        const text = paragraph.replace(/<[^>]*>/g, "").trim();
        if (text) {
          doc.content.push({
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text
                  }
                ]
              }
            ]
          });
        }
        return;
      }
      const cleanedParagraph = paragraph.replace(/<p[^>]*>/, "");
      if (!cleanedParagraph.trim()) return;
      const paragraphContent = [];
      let remainingText = cleanedParagraph;
      while (remainingText.length > 0) {
        const boldMatch = remainingText.match(
          /<(strong|b)>(.*?)<\/(strong|b)>/
        );
        if (boldMatch) {
          const beforeText = remainingText.substring(0, boldMatch.index).replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: boldMatch[2],
            marks: [{ type: "strong" }]
          });
          remainingText = remainingText.substring(
            boldMatch.index + boldMatch[0].length
          );
          continue;
        }
        const italicMatch = remainingText.match(/<(em|i)>(.*?)<\/(em|i)>/);
        if (italicMatch) {
          const beforeText = remainingText.substring(0, italicMatch.index).replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: italicMatch[2],
            marks: [{ type: "em" }]
          });
          remainingText = remainingText.substring(
            italicMatch.index + italicMatch[0].length
          );
          continue;
        }
        const underlineMatch = remainingText.match(/<u>(.*?)<\/u>/);
        if (underlineMatch) {
          const beforeText = remainingText.substring(0, underlineMatch.index).replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: underlineMatch[1],
            marks: [{ type: "underline" }]
          });
          remainingText = remainingText.substring(
            underlineMatch.index + underlineMatch[0].length
          );
          continue;
        }
        const codeMatch = remainingText.match(/<code>(.*?)<\/code>/);
        if (codeMatch) {
          const beforeText = remainingText.substring(0, codeMatch.index).replace(/<[^>]*>/g, "");
          if (beforeText) {
            paragraphContent.push({ type: "text", text: beforeText });
          }
          paragraphContent.push({
            type: "text",
            text: codeMatch[1],
            marks: [{ type: "code" }]
          });
          remainingText = remainingText.substring(
            codeMatch.index + codeMatch[0].length
          );
          continue;
        }
        const plainText = remainingText.replace(/<[^>]*>/g, "").trim();
        if (plainText) {
          paragraphContent.push({ type: "text", text: plainText });
        }
        break;
      }
      if (paragraphContent.length > 0) {
        doc.content.push({
          type: "paragraph",
          content: paragraphContent
        });
      }
    });
    if (doc.content.length === 0) {
      doc.content.push({
        type: "paragraph",
        content: []
      });
    }
    return doc;
  }
  async searchUsers(query, projectKey, startAt = 0, maxResults = 50) {
    try {
      const isEmail = query.includes("@");
      const allUsers = [];
      if (isEmail) {
        try {
          const emailSearchUrl = this.buildUrl(
            `/rest/api/3/user/search?query=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`
          );
          const emailUsers = await this.makeRequest(emailSearchUrl);
          allUsers.push(...emailUsers);
          const accountSearchUrl = this.buildUrl(
            `/rest/api/3/user/search?accountId=${encodeURIComponent(query)}`
          );
          try {
            const accountUsers = await this.makeRequest(accountSearchUrl);
            allUsers.push(...accountUsers);
          } catch (e) {
          }
        } catch (error) {
        }
      }
      let endpoint;
      if (projectKey && !isEmail) {
        endpoint = `/rest/api/3/user/assignable/search?project=${projectKey}&query=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`;
      } else {
        endpoint = `/rest/api/3/user/search?query=${encodeURIComponent(query)}&startAt=${startAt}&maxResults=${maxResults}`;
      }
      const url = this.buildUrl(endpoint);
      const generalUsers = await this.makeRequest(url);
      allUsers.push(...generalUsers);
      const uniqueUsers = /* @__PURE__ */ new Map();
      allUsers.forEach((user) => {
        if (user.accountId && !uniqueUsers.has(user.accountId)) {
          uniqueUsers.set(user.accountId, user);
        }
      });
      const users = Array.from(uniqueUsers.values());
      const mappedUsers = users.map((user) => {
        const mapped = {
          accountId: user.accountId,
          displayName: user.displayName,
          emailAddress: user.emailAddress,
          avatarUrls: user.avatarUrls
        };
        return mapped;
      });
      const hasMore = mappedUsers.length >= maxResults;
      const estimatedTotal = hasMore ? startAt + mappedUsers.length + 1 : startAt + mappedUsers.length;
      return {
        users: mappedUsers,
        total: estimatedTotal
      };
    } catch (error) {
      console.error("[JiraAdapter.searchUsers] Failed to search users:", error);
      return { users: [], total: 0 };
    }
  }
  async getCurrentUser() {
    try {
      const url = this.buildUrl("/rest/api/3/myself");
      const user = await this.makeRequest(url);
      return {
        accountId: user.accountId,
        displayName: user.displayName,
        emailAddress: user.emailAddress
      };
    } catch (error) {
      console.error(
        "[JiraAdapter.getCurrentUser] Failed to get current user:",
        error
      );
      return null;
    }
  }
};

// lib/integrations/adapters/GitHubAdapter.ts
var GitHubAdapter = class extends BaseAdapter {
  owner;
  repo;
  baseUrl = "https://api.github.com";
  constructor(config) {
    super(config);
    if (config.repository) {
      const [owner, repo] = config.repository.split("/");
      this.owner = owner;
      this.repo = repo;
    }
  }
  getCapabilities() {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: true,
      customFields: false,
      // GitHub doesn't have custom fields like Jira
      attachments: false
      // GitHub doesn't support direct attachments on issues
    };
  }
  async performAuthentication(authData) {
    if (authData.type !== "api_key") {
      throw new Error(
        "GitHub adapter only supports Personal Access Token authentication"
      );
    }
    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for GitHub authentication"
      );
    }
    try {
      await this.makeRequest(`${this.baseUrl}/user`);
    } catch (error) {
      throw new Error("Invalid GitHub Personal Access Token");
    }
  }
  buildUrl(path) {
    if (path.startsWith("/repos/") && this.owner && this.repo) {
      return `${this.baseUrl}${path.replace("{owner}/{repo}", `${this.owner}/${this.repo}`)}`;
    }
    return `${this.baseUrl}${path}`;
  }
  async createIssue(data) {
    if (!this.owner || !this.repo) {
      if (data.projectId.includes("/")) {
        const [owner, repo] = data.projectId.split("/");
        this.owner = owner;
        this.repo = repo;
      } else {
        throw new Error(
          "GitHub repository not configured. Expected format: owner/repo"
        );
      }
    }
    const githubPayload = {
      title: data.title,
      body: data.description || "",
      labels: data.labels || [],
      assignees: data.assigneeId ? [data.assigneeId] : void 0
    };
    const response = await this.makeRequest(
      this.buildUrl(`/repos/{owner}/{repo}/issues`),
      {
        method: "POST",
        body: JSON.stringify(githubPayload)
      }
    );
    return this.mapGitHubIssue(response);
  }
  async updateIssue(issueId, data) {
    const updatePayload = {};
    if (data.title !== void 0) {
      updatePayload.title = data.title;
    }
    if (data.description !== void 0) {
      updatePayload.body = data.description;
    }
    if (data.status !== void 0) {
      updatePayload.state = this.mapStatusToGitHub(data.status);
    }
    if (data.labels !== void 0) {
      updatePayload.labels = data.labels;
    }
    if (data.assigneeId !== void 0) {
      updatePayload.assignees = [data.assigneeId];
    }
    const response = await this.makeRequest(
      this.buildUrl(`/repos/{owner}/{repo}/issues/${issueId}`),
      {
        method: "PATCH",
        body: JSON.stringify(updatePayload)
      }
    );
    return this.mapGitHubIssue(response);
  }
  async getIssue(issueId) {
    let owner = this.owner;
    let repo = this.repo;
    let issueNumber = issueId;
    const repoIssueMatch = issueId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (repoIssueMatch) {
      owner = repoIssueMatch[1];
      repo = repoIssueMatch[2];
      issueNumber = repoIssueMatch[3];
    } else if (issueId.startsWith("#")) {
      issueNumber = issueId.substring(1);
    }
    if (!owner || !repo) {
      throw new Error(
        "GitHub repository not configured. Cannot fetch issue without owner/repo context."
      );
    }
    const response = await this.makeRequest(
      `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}`
    );
    return this.mapGitHubIssue(response);
  }
  async searchIssues(options) {
    const searchQuery = [];
    searchQuery.push("is:issue");
    if (this.owner && this.repo) {
      searchQuery.push(`repo:${this.owner}/${this.repo}`);
    } else if (options.projectId) {
      searchQuery.push(`repo:${options.projectId}`);
    }
    if (options.query) {
      searchQuery.push(options.query);
    }
    if (options.status && options.status.length > 0) {
      const states = options.status.map((s) => this.mapStatusToGitHub(s));
      searchQuery.push(`is:${states.join(" is:")}`);
    }
    if (options.assignee) {
      searchQuery.push(`assignee:${options.assignee}`);
    }
    if (options.labels && options.labels.length > 0) {
      searchQuery.push(options.labels.map((l) => `label:"${l}"`).join(" "));
    }
    const params = new URLSearchParams({
      q: searchQuery.join(" "),
      per_page: (options.limit || 30).toString(),
      page: Math.floor(
        (options.offset || 0) / (options.limit || 30) + 1
      ).toString(),
      sort: "created",
      order: "desc"
    });
    const response = await this.makeRequest(
      `${this.baseUrl}/search/issues?${params.toString()}`
    );
    return {
      issues: response.items.map((issue) => this.mapGitHubIssue(issue)),
      total: response.total_count,
      hasMore: response.incomplete_results || response.total_count > (options.offset || 0) + response.items.length
    };
  }
  async addComment(issueId, comment) {
    await this.makeRequest(
      this.buildUrl(`/repos/{owner}/{repo}/issues/${issueId}/comments`),
      {
        method: "POST",
        body: JSON.stringify({ body: comment })
      }
    );
  }
  /**
   * Get available repositories for the authenticated user
   */
  async getProjects() {
    const repos = await this.makeRequest(
      `${this.baseUrl}/user/repos?per_page=100&sort=updated`
    );
    return repos.map((repo) => ({
      id: repo.full_name,
      key: repo.name,
      name: repo.full_name
    }));
  }
  /**
   * Get available labels for a repository
   */
  async getLabels() {
    if (!this.owner || !this.repo) {
      throw new Error("Repository not configured");
    }
    const labels = await this.makeRequest(
      this.buildUrl(`/repos/{owner}/{repo}/labels`)
    );
    return labels.map((label) => ({
      id: label.name,
      name: label.name,
      color: label.color
    }));
  }
  /**
   * Get available milestones for a repository
   */
  async getMilestones() {
    if (!this.owner || !this.repo) {
      throw new Error("Repository not configured");
    }
    const milestones = await this.makeRequest(
      this.buildUrl(`/repos/{owner}/{repo}/milestones`)
    );
    return milestones.map((milestone) => ({
      id: milestone.number.toString(),
      title: milestone.title,
      state: milestone.state
    }));
  }
  mapStatusToGitHub(status) {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus === "closed" || lowerStatus === "done" || lowerStatus === "resolved") {
      return "closed";
    }
    return "open";
  }
  mapGitHubIssue(githubIssue) {
    let owner = this.owner;
    let repo = this.repo;
    if (githubIssue.repository_url) {
      const match = githubIssue.repository_url.match(/\/repos\/([^/]+)\/([^/]+)$/);
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    } else if (githubIssue.html_url) {
      const match = githubIssue.html_url.match(/github\.com\/([^/]+)\/([^/]+)\/issues/);
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    }
    return {
      id: githubIssue.number.toString(),
      key: `#${githubIssue.number}`,
      title: githubIssue.title,
      description: githubIssue.body,
      status: githubIssue.state,
      priority: void 0,
      // GitHub doesn't have priority
      assignee: githubIssue.assignee ? {
        id: githubIssue.assignee.login,
        name: githubIssue.assignee.login,
        email: githubIssue.assignee.email
      } : void 0,
      reporter: githubIssue.user ? {
        id: githubIssue.user.login,
        name: githubIssue.user.login,
        email: githubIssue.user.email
      } : void 0,
      labels: githubIssue.labels.map((label) => label.name),
      // Store repo context in customFields for sync support
      customFields: {
        _github_owner: owner,
        _github_repo: repo
      },
      createdAt: new Date(githubIssue.created_at),
      updatedAt: new Date(githubIssue.updated_at),
      url: githubIssue.html_url
    };
  }
  async linkToTestCase(issueId, testCaseId, metadata) {
    const comment = `Linked to test case: ${testCaseId}${metadata ? `

Metadata: ${JSON.stringify(metadata, null, 2)}` : ""}`;
    await this.addComment(issueId, comment);
  }
  async syncIssue(issueId) {
    return this.getIssue(issueId);
  }
};

// lib/integrations/adapters/AzureDevOpsAdapter.ts
var AzureDevOpsAdapter = class extends BaseAdapter {
  organizationUrl;
  project;
  apiVersion = "7.0";
  constructor(config) {
    super(config);
    this.organizationUrl = config.organizationUrl;
    this.project = config.project;
  }
  getCapabilities() {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: true,
      customFields: true,
      attachments: true
    };
  }
  async performAuthentication(authData) {
    if (authData.type !== "api_key") {
      throw new Error(
        "Azure DevOps adapter only supports Personal Access Token authentication"
      );
    }
    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for Azure DevOps authentication"
      );
    }
    if (!this.organizationUrl) {
      throw new Error("Organization URL is required for Azure DevOps");
    }
    try {
      await this.makeRequest(
        `${this.organizationUrl}/_apis/projects?api-version=${this.apiVersion}`
      );
    } catch (error) {
      throw new Error(
        "Invalid Azure DevOps Personal Access Token or Organization URL"
      );
    }
  }
  buildUrl(path) {
    if (!this.organizationUrl) {
      throw new Error("Organization URL not configured");
    }
    if (path.includes("{project}") && this.project) {
      path = path.replace("{project}", encodeURIComponent(this.project));
    }
    return `${this.organizationUrl}${path}`;
  }
  async createIssue(data) {
    if (!this.project && data.projectId) {
      this.project = data.projectId;
    }
    if (!this.project) {
      throw new Error("Azure DevOps project not configured");
    }
    const patchDocument = [
      {
        op: "add",
        path: "/fields/System.Title",
        value: data.title
      }
    ];
    if (data.description) {
      let descriptionValue;
      if (typeof data.description === "object" && data.description && "type" in data.description && data.description.type === "doc") {
        descriptionValue = this.extractTextFromTiptap(data.description);
      } else {
        descriptionValue = data.description;
      }
      patchDocument.push({
        op: "add",
        path: "/fields/System.Description",
        value: descriptionValue
      });
    }
    if (data.priority) {
      patchDocument.push({
        op: "add",
        path: "/fields/Microsoft.VSTS.Common.Priority",
        value: parseInt(data.priority)
      });
    }
    if (data.assigneeId) {
      patchDocument.push({
        op: "add",
        path: "/fields/System.AssignedTo",
        value: data.assigneeId
      });
    }
    if (data.labels && data.labels.length > 0) {
      patchDocument.push({
        op: "add",
        path: "/fields/System.Tags",
        value: data.labels.join("; ")
      });
    }
    if (data.customFields) {
      for (const [field, value] of Object.entries(data.customFields)) {
        patchDocument.push({
          op: "add",
          path: `/fields/${field}`,
          value
        });
      }
    }
    const workItemType = data.issueType || "Bug";
    const response = await this.makeRequest(
      this.buildUrl(
        `/{project}/_apis/wit/workitems/$${workItemType}?api-version=${this.apiVersion}`
      ),
      {
        method: "POST",
        body: JSON.stringify(patchDocument),
        headers: {
          "Content-Type": "application/json-patch+json"
        }
      }
    );
    return this.mapAzureDevOpsWorkItem(response);
  }
  async updateIssue(issueId, data) {
    const patchDocument = [];
    if (data.title !== void 0) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.Title",
        value: data.title
      });
    }
    if (data.description !== void 0) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.Description",
        value: data.description
      });
    }
    if (data.status !== void 0) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.State",
        value: data.status
      });
    }
    if (data.priority !== void 0) {
      patchDocument.push({
        op: "replace",
        path: "/fields/Microsoft.VSTS.Common.Priority",
        value: parseInt(data.priority)
      });
    }
    if (data.assigneeId !== void 0) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.AssignedTo",
        value: data.assigneeId
      });
    }
    if (data.labels !== void 0) {
      patchDocument.push({
        op: "replace",
        path: "/fields/System.Tags",
        value: data.labels.join("; ")
      });
    }
    if (data.customFields) {
      for (const [field, value] of Object.entries(data.customFields)) {
        patchDocument.push({
          op: "replace",
          path: `/fields/${field}`,
          value
        });
      }
    }
    const response = await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}?api-version=${this.apiVersion}`
      ),
      {
        method: "PATCH",
        body: JSON.stringify(patchDocument),
        headers: {
          "Content-Type": "application/json-patch+json"
        }
      }
    );
    return this.mapAzureDevOpsWorkItem(response);
  }
  async getIssue(issueId) {
    const response = await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}?api-version=${this.apiVersion}&$expand=all`
      )
    );
    return this.mapAzureDevOpsWorkItem(response);
  }
  async searchIssues(options) {
    const conditions = [];
    if (this.project) {
      conditions.push(`[System.TeamProject] = '${this.project}'`);
    } else if (options.projectId) {
      conditions.push(`[System.TeamProject] = '${options.projectId}'`);
    }
    if (options.query) {
      conditions.push(
        `([System.Title] CONTAINS '${options.query}' OR [System.Description] CONTAINS '${options.query}')`
      );
    }
    if (options.status && options.status.length > 0) {
      const statusCondition = options.status.map((s) => `[System.State] = '${s}'`).join(" OR ");
      conditions.push(`(${statusCondition})`);
    }
    if (options.assignee) {
      conditions.push(`[System.AssignedTo] = '${options.assignee}'`);
    }
    if (options.labels && options.labels.length > 0) {
      const labelConditions = options.labels.map(
        (l) => `[System.Tags] CONTAINS '${l}'`
      );
      conditions.push(`(${labelConditions.join(" OR ")})`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const wiql = `SELECT [System.Id] FROM WorkItems ${whereClause} ORDER BY [System.CreatedDate] DESC`;
    const wiqlResponse = await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/wiql?api-version=${this.apiVersion}&$top=${options.limit || 200}`
      ),
      {
        method: "POST",
        body: JSON.stringify({ query: wiql })
      }
    );
    if (!wiqlResponse.workItems || wiqlResponse.workItems.length === 0) {
      return {
        issues: [],
        total: 0,
        hasMore: false
      };
    }
    const ids = wiqlResponse.workItems.slice(options.offset || 0, (options.offset || 0) + (options.limit || 50)).map((item) => item.id);
    if (ids.length === 0) {
      return {
        issues: [],
        total: wiqlResponse.workItems.length,
        hasMore: false
      };
    }
    const response = await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/workitems?ids=${ids.join(",")}&api-version=${this.apiVersion}&$expand=all`
      )
    );
    return {
      issues: response.value.map(
        (item) => this.mapAzureDevOpsWorkItem(item)
      ),
      total: wiqlResponse.workItems.length,
      hasMore: (options.offset || 0) + ids.length < wiqlResponse.workItems.length
    };
  }
  async addComment(issueId, comment) {
    await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}/comments?api-version=${this.apiVersion}-preview`
      ),
      {
        method: "POST",
        body: JSON.stringify({ text: comment })
      }
    );
  }
  /**
   * Get available projects
   */
  async getProjects() {
    const response = await this.makeRequest(
      this.buildUrl(`/_apis/projects?api-version=${this.apiVersion}`)
    );
    return response.value.map((project) => ({
      id: project.id,
      key: project.name,
      name: project.name
    }));
  }
  /**
   * Get work item types for a project
   */
  async getIssueTypes(projectId) {
    const project = projectId || this.project;
    if (!project) {
      throw new Error("Project not specified");
    }
    const response = await this.makeRequest(
      this.buildUrl(
        `/${project}/_apis/wit/workitemtypes?api-version=${this.apiVersion}`
      )
    );
    return response.value.map((type) => ({
      id: type.name,
      name: type.name
    }));
  }
  /**
   * Get available states for work items
   */
  async getStatuses() {
    return [
      { id: "New", name: "New" },
      { id: "Active", name: "Active" },
      { id: "Resolved", name: "Resolved" },
      { id: "Closed", name: "Closed" },
      { id: "Removed", name: "Removed" }
    ];
  }
  /**
   * Get priorities
   */
  async getPriorities() {
    return [
      { id: "1", name: "1 - Critical" },
      { id: "2", name: "2 - High" },
      { id: "3", name: "3 - Medium" },
      { id: "4", name: "4 - Low" }
    ];
  }
  /**
   * Upload attachment to a work item
   */
  async uploadAttachment(issueId, file, filename) {
    const uploadResponse = await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/attachments?fileName=${encodeURIComponent(filename)}&api-version=${this.apiVersion}`
      ),
      {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": "application/octet-stream"
        }
      }
    );
    const patchDocument = [
      {
        op: "add",
        path: "/relations/-",
        value: {
          rel: "AttachedFile",
          url: uploadResponse.url
        }
      }
    ];
    await this.makeRequest(
      this.buildUrl(
        `/_apis/wit/workitems/${issueId}?api-version=${this.apiVersion}`
      ),
      {
        method: "PATCH",
        body: JSON.stringify(patchDocument),
        headers: {
          "Content-Type": "application/json-patch+json"
        }
      }
    );
    return {
      id: uploadResponse.id,
      url: uploadResponse.url
    };
  }
  mapAzureDevOpsWorkItem(workItem) {
    const fields = workItem.fields;
    return {
      id: workItem.id.toString(),
      key: workItem.id.toString(),
      title: fields["System.Title"],
      description: fields["System.Description"],
      status: fields["System.State"],
      priority: fields["Microsoft.VSTS.Common.Priority"]?.toString(),
      assignee: fields["System.AssignedTo"] ? {
        id: fields["System.AssignedTo"].uniqueName || fields["System.AssignedTo"],
        name: fields["System.AssignedTo"].displayName || fields["System.AssignedTo"],
        email: fields["System.AssignedTo"].uniqueName
      } : void 0,
      reporter: fields["System.CreatedBy"] ? {
        id: fields["System.CreatedBy"].uniqueName || fields["System.CreatedBy"],
        name: fields["System.CreatedBy"].displayName || fields["System.CreatedBy"],
        email: fields["System.CreatedBy"].uniqueName
      } : void 0,
      labels: fields["System.Tags"] ? fields["System.Tags"].split(";").map((tag) => tag.trim()) : [],
      customFields: this.extractCustomFields(fields),
      createdAt: new Date(fields["System.CreatedDate"]),
      updatedAt: new Date(fields["System.ChangedDate"]),
      url: workItem._links?.html?.href || workItem.url
    };
  }
  extractCustomFields(fields) {
    const customFields = {};
    const systemFields = [
      "System.Id",
      "System.Title",
      "System.Description",
      "System.State",
      "System.AssignedTo",
      "System.CreatedBy",
      "System.CreatedDate",
      "System.ChangedDate",
      "System.Tags",
      "System.TeamProject",
      "System.WorkItemType",
      "Microsoft.VSTS.Common.Priority"
    ];
    for (const [key, value] of Object.entries(fields)) {
      if (!systemFields.includes(key) && value !== null && value !== void 0) {
        customFields[key] = value;
      }
    }
    return customFields;
  }
  async linkToTestCase(issueId, testCaseId, metadata) {
    const comment = `Linked to test case: ${testCaseId}${metadata ? `

Metadata: ${JSON.stringify(metadata, null, 2)}` : ""}`;
    await this.addComment(issueId, comment);
  }
  async syncIssue(issueId) {
    return this.getIssue(issueId);
  }
  extractTextFromTiptap(tiptapJson) {
    let text = "";
    if (tiptapJson.content && Array.isArray(tiptapJson.content)) {
      tiptapJson.content.forEach((node) => {
        if (node.type === "text") {
          text += node.text || "";
        } else if (node.content && Array.isArray(node.content)) {
          text += this.extractTextFromTiptap(node) + "\n";
        }
      });
    }
    return text.trim();
  }
};

// lib/integrations/adapters/SimpleUrlAdapter.ts
init_prismaBase();
var SimpleUrlAdapter = class extends BaseAdapter {
  /**
   * Get the capabilities of this adapter
   */
  getCapabilities() {
    return {
      createIssue: false,
      // Simple URL adapters typically can't create issues
      updateIssue: false,
      // Simple URL adapters typically can't update issues
      linkIssue: true,
      // Can link to existing issues via URL
      syncIssue: false,
      // Can't sync since no API access
      searchIssues: true,
      // Can provide basic search functionality
      webhooks: false,
      // No webhook support
      customFields: false,
      // No custom field support
      attachments: false
      // No attachment support
    };
  }
  /**
   * Perform adapter-specific authentication
   * Simple URL adapters don't typically require authentication
   */
  async performAuthentication(authData) {
    if (!authData.baseUrl && !this.config.baseUrl) {
      throw new Error("Base URL is required for Simple URL integration");
    }
  }
  /**
   * Create a new issue - not supported by Simple URL adapters
   */
  async createIssue(_data) {
    throw new Error("Creating issues is not supported by Simple URL integration");
  }
  /**
   * Update an existing issue - not supported by Simple URL adapters
   */
  async updateIssue(_issueId, _data) {
    throw new Error("Updating issues is not supported by Simple URL integration");
  }
  /**
   * Get a single issue by ID - creates a mock issue based on URL pattern
   */
  async getIssue(issueId) {
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }
    const url = baseUrl.replace("{issueId}", issueId).replace("'{issueId}'", issueId);
    return {
      id: issueId,
      key: issueId,
      title: `Issue ${issueId}`,
      description: `Issue linked via Simple URL integration`,
      status: "Unknown",
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date(),
      url
    };
  }
  /**
   * Search for issues - searches the internal database for issues linked to this integration
   */
  async searchIssues(options) {
    const { query = "", limit = 10 } = options;
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }
    const integrationId = this.config.integrationId;
    if (!integrationId) {
      throw new Error("Integration ID not configured");
    }
    const where = {
      integrationId,
      isDeleted: false
    };
    if (query.trim()) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        { externalId: { contains: query, mode: "insensitive" } },
        { externalKey: { contains: query, mode: "insensitive" } }
      ];
    }
    const total = await prisma.issue.count({ where });
    const dbIssues = await prisma.issue.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        externalId: true,
        externalKey: true,
        externalUrl: true,
        externalStatus: true,
        createdAt: true
      }
    });
    const issues = dbIssues.map((dbIssue) => {
      let url = dbIssue.externalUrl;
      if (!url && (dbIssue.externalId || dbIssue.externalKey)) {
        const issueId = dbIssue.externalId || dbIssue.externalKey || dbIssue.id.toString();
        url = baseUrl.replace("{issueId}", issueId).replace("'{issueId}'", issueId);
      }
      return {
        id: dbIssue.externalId || dbIssue.externalKey || dbIssue.id.toString(),
        key: dbIssue.externalKey || dbIssue.externalId || dbIssue.name,
        title: dbIssue.title,
        description: dbIssue.description || void 0,
        status: dbIssue.externalStatus || dbIssue.status || "Unknown",
        priority: dbIssue.priority || void 0,
        createdAt: dbIssue.createdAt,
        updatedAt: dbIssue.createdAt,
        // Use createdAt since Issue model doesn't have updatedAt
        url: url || void 0
      };
    });
    return {
      issues,
      total,
      hasMore: dbIssues.length === limit && total > limit
    };
  }
  /**
   * Link an issue to a test case
   */
  async linkToTestCase(issueId, _testCaseId, _metadata) {
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      throw new Error("Base URL not configured");
    }
    const url = baseUrl.replace("{issueId}", issueId).replace("'{issueId}'", issueId);
    try {
      new URL(url);
    } catch (error) {
      throw new Error(`Invalid URL generated: ${url}`);
    }
  }
  /**
   * Validate configuration
   */
  async validateConfiguration() {
    const errors = [];
    const baseUrl = this.authData?.baseUrl || this.config.baseUrl;
    if (!baseUrl) {
      errors.push("Base URL is required");
    } else {
      if (!baseUrl.includes("{issueId}") && !baseUrl.includes("'{issueId}'")) {
        errors.push("Base URL must contain {issueId} placeholder");
      }
      try {
        const testUrl = baseUrl.replace("{issueId}", "TEST-1").replace("'{issueId}'", "TEST-1");
        new URL(testUrl);
      } catch (error) {
        errors.push("Base URL pattern is not a valid URL format");
      }
    }
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : void 0
    };
  }
};

// utils/encryption.ts
var import_crypto = __toESM(require("crypto"));
var algorithm = "aes-256-gcm";
var ivLength = 16;
var saltLength = 32;
var tagLength = 16;
var iterations = 1e5;
var keyLength = 32;
var getMasterKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    console.warn("ENCRYPTION_KEY not set, using default key for development");
    return "development-key-do-not-use-in-production-please!";
  }
  return key;
};
var deriveKey = (password, salt) => {
  return import_crypto.default.pbkdf2Sync(password, salt, iterations, keyLength, "sha256");
};
var EncryptionService = class {
  static encrypt(text, key) {
    const salt = import_crypto.default.randomBytes(saltLength);
    const derivedKey = deriveKey(key, salt);
    const iv = import_crypto.default.randomBytes(ivLength);
    const cipher = import_crypto.default.createCipheriv(algorithm, derivedKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([salt, iv, tag, encrypted]);
    return combined.toString("base64");
  }
  static decrypt(encryptedText, key) {
    const combined = Buffer.from(encryptedText, "base64");
    const salt = combined.slice(0, saltLength);
    const iv = combined.slice(saltLength, saltLength + ivLength);
    const tag = combined.slice(
      saltLength + ivLength,
      saltLength + ivLength + tagLength
    );
    const encrypted = combined.slice(saltLength + ivLength + tagLength);
    const derivedKey = deriveKey(key, salt);
    const decipher = import_crypto.default.createDecipheriv(algorithm, derivedKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }
  static encryptObject(obj, key) {
    return this.encrypt(JSON.stringify(obj), key);
  }
  static decryptObject(encryptedText, key) {
    return JSON.parse(this.decrypt(encryptedText, key));
  }
};

// lib/integrations/IntegrationManager.ts
var IntegrationManager = class _IntegrationManager {
  static instance;
  adapterRegistry = /* @__PURE__ */ new Map();
  adapterCache = /* @__PURE__ */ new Map();
  constructor() {
    this.registerAdapters();
  }
  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!_IntegrationManager.instance) {
      _IntegrationManager.instance = new _IntegrationManager();
    }
    return _IntegrationManager.instance;
  }
  /**
   * Register built-in adapters
   */
  registerAdapters() {
    this.registerAdapter("JIRA", JiraAdapter);
    this.registerAdapter("GITHUB", GitHubAdapter);
    this.registerAdapter("AZURE_DEVOPS", AzureDevOpsAdapter);
    this.registerAdapter("SIMPLE_URL", SimpleUrlAdapter);
  }
  /**
   * Register a new adapter type
   */
  registerAdapter(type, adapterClass) {
    this.adapterRegistry.set(type, adapterClass);
  }
  /**
   * Get adapter for a specific integration
   */
  async getAdapter(integrationId) {
    if (this.adapterCache.has(integrationId)) {
      return this.adapterCache.get(integrationId);
    }
    const integration = await prisma.integration.findUnique({
      where: { id: parseInt(integrationId) },
      include: {
        userIntegrationAuths: {
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
          take: 1
        }
      }
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
    const config = await this.buildAdapterConfig(integration);
    const adapter = new AdapterClass(config);
    const masterKey = getMasterKey();
    const authData = {
      type: this.mapAuthType(integration.authType)
    };
    if ((integration.authType === "API_KEY" || integration.authType === "PERSONAL_ACCESS_TOKEN") && integration.credentials) {
      let credentials = integration.credentials;
      if (typeof credentials === "object" && "encrypted" in credentials) {
        const decrypted = EncryptionService.decrypt(
          credentials.encrypted,
          masterKey
        );
        credentials = JSON.parse(decrypted);
      }
      if (credentials.email) authData.email = credentials.email;
      if (credentials.apiToken) authData.apiToken = credentials.apiToken;
      if (credentials.personalAccessToken) authData.apiKey = credentials.personalAccessToken;
      if (integration.settings && typeof integration.settings === "object") {
        const settings = integration.settings;
        if (settings.baseUrl) authData.baseUrl = settings.baseUrl;
      }
      await adapter.authenticate(authData);
    } else if (integration.userIntegrationAuths.length > 0) {
      const auth = integration.userIntegrationAuths[0];
      authData.expiresAt = auth.tokenExpiresAt || void 0;
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
    this.adapterCache.set(integrationId, adapter);
    return adapter;
  }
  /**
   * Map IntegrationAuthType enum to authentication type string
   */
  mapAuthType(authType) {
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
  async buildAdapterConfig(integration) {
    const config = {
      integrationId: integration.id,
      name: integration.name,
      provider: integration.provider
    };
    if (integration.settings && typeof integration.settings === "object") {
      Object.assign(config, integration.settings);
    }
    return config;
  }
  /**
   * Clear adapter from cache
   */
  clearAdapter(integrationId) {
    this.adapterCache.delete(integrationId);
  }
  /**
   * Clear all cached adapters
   */
  clearAllAdapters() {
    this.adapterCache.clear();
  }
  /**
   * Get all registered adapter types
   */
  getRegisteredTypes() {
    return Array.from(this.adapterRegistry.keys());
  }
  /**
   * Check if adapter type is registered
   */
  isTypeRegistered(type) {
    return this.adapterRegistry.has(type);
  }
  /**
   * Get adapter capabilities for a specific integration
   */
  async getCapabilities(integrationId) {
    const adapter = await this.getAdapter(integrationId);
    return adapter ? adapter.getCapabilities() : null;
  }
  /**
   * Validate integration configuration
   */
  async validateIntegration(integrationId) {
    try {
      const adapter = await this.getAdapter(integrationId);
      if (!adapter) {
        return { valid: false, errors: ["Adapter not found"] };
      }
      const isAuthenticated = await adapter.isAuthenticated();
      if (!isAuthenticated) {
        return { valid: false, errors: ["Authentication failed"] };
      }
      if (adapter.validateConfiguration) {
        return await adapter.validateConfiguration();
      }
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : "Unknown error"]
      };
    }
  }
};
var integrationManager = IntegrationManager.getInstance();

// lib/integrations/services/SyncService.ts
init_prismaBase();

// services/elasticsearchService.ts
var import_elasticsearch = require("@elastic/elasticsearch");

// env.js
var import_env_nextjs = require("@t3-oss/env-nextjs");
var import_v4 = require("zod/v4");
var env = (0, import_env_nextjs.createEnv)({
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

// services/elasticsearchService.ts
init_prismaBase();
var esClient = null;
function getElasticsearchClient() {
  if (!env.ELASTICSEARCH_NODE) {
    console.warn(
      "ELASTICSEARCH_NODE environment variable not set. Elasticsearch integration disabled."
    );
    return null;
  }
  if (!esClient) {
    try {
      esClient = new import_elasticsearch.Client({
        node: env.ELASTICSEARCH_NODE,
        // Add additional configuration as needed
        maxRetries: 3,
        requestTimeout: 3e4,
        sniffOnStart: false
        // Disable sniffing for custom ports
      });
    } catch (error) {
      console.error("Failed to initialize Elasticsearch client:", error);
      return null;
    }
  }
  return esClient;
}

// services/unifiedElasticsearchService.ts
init_prismaBase();
var BASE_INDEX_NAMES = {
  ["repository_case" /* REPOSITORY_CASE */]: "repository-cases",
  ["shared_step" /* SHARED_STEP */]: "shared-steps",
  ["test_run" /* TEST_RUN */]: "test-runs",
  ["session" /* SESSION */]: "sessions",
  ["project" /* PROJECT */]: "projects",
  ["issue" /* ISSUE */]: "issues",
  ["milestone" /* MILESTONE */]: "milestones"
};
function getEntityIndexName(entityType, tenantId) {
  const baseName = BASE_INDEX_NAMES[entityType];
  if (tenantId) {
    return `testplanit-${tenantId}-${baseName}`;
  }
  return `testplanit-${baseName}`;
}
var ENTITY_INDICES = {
  ["repository_case" /* REPOSITORY_CASE */]: "testplanit-repository-cases",
  ["shared_step" /* SHARED_STEP */]: "testplanit-shared-steps",
  ["test_run" /* TEST_RUN */]: "testplanit-test-runs",
  ["session" /* SESSION */]: "testplanit-sessions",
  ["project" /* PROJECT */]: "testplanit-projects",
  ["issue" /* ISSUE */]: "testplanit-issues",
  ["milestone" /* MILESTONE */]: "testplanit-milestones"
};
var baseMapping = {
  properties: {
    id: { type: "integer" },
    projectId: { type: "integer" },
    projectName: { type: "keyword" },
    projectIconUrl: { type: "keyword" },
    createdAt: { type: "date" },
    updatedAt: { type: "date" },
    createdById: { type: "keyword" },
    createdByName: { type: "keyword" },
    createdByImage: { type: "keyword" },
    searchableContent: {
      type: "text",
      analyzer: "standard",
      fields: {
        keyword: {
          type: "keyword",
          ignore_above: 256
        }
      }
    },
    customFields: {
      type: "nested",
      properties: {
        fieldId: { type: "integer" },
        fieldName: { type: "keyword" },
        fieldType: { type: "keyword" },
        value: { type: "text" },
        valueKeyword: { type: "keyword" },
        valueNumeric: { type: "double" },
        valueBoolean: { type: "boolean" },
        valueDate: { type: "date" },
        valueArray: { type: "keyword" },
        fieldOption: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "keyword" },
            icon: {
              type: "object",
              properties: {
                name: { type: "keyword" }
              }
            },
            iconColor: {
              type: "object",
              properties: {
                value: { type: "keyword" }
              }
            }
          }
        },
        fieldOptions: {
          type: "nested",
          properties: {
            id: { type: "integer" },
            name: { type: "keyword" },
            icon: {
              type: "object",
              properties: {
                name: { type: "keyword" }
              }
            },
            iconColor: {
              type: "object",
              properties: {
                value: { type: "keyword" }
              }
            }
          }
        }
      }
    }
  }
};
var ENTITY_MAPPINGS = {
  ["repository_case" /* REPOSITORY_CASE */]: {
    properties: {
      ...baseMapping.properties,
      repositoryId: { type: "integer" },
      folderId: { type: "integer" },
      folderPath: { type: "keyword" },
      templateId: { type: "integer" },
      templateName: { type: "keyword" },
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      className: { type: "keyword" },
      source: { type: "keyword" },
      stateId: { type: "integer" },
      stateName: { type: "keyword" },
      stateIcon: { type: "keyword" },
      stateColor: { type: "keyword" },
      estimate: { type: "integer" },
      forecastManual: { type: "integer" },
      forecastAutomated: { type: "float" },
      automated: { type: "boolean" },
      isArchived: { type: "boolean" },
      isDeleted: { type: "boolean" },
      tags: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          name: { type: "keyword" }
        }
      },
      steps: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          order: { type: "integer" },
          step: { type: "text" },
          expectedResult: { type: "text" },
          isSharedStep: { type: "boolean" },
          sharedStepGroupId: { type: "integer" },
          sharedStepGroupName: { type: "text" }
        }
      }
    }
  },
  ["shared_step" /* SHARED_STEP */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      isDeleted: { type: "boolean" },
      items: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          order: { type: "integer" },
          step: { type: "text" },
          expectedResult: { type: "text" }
        }
      }
    }
  },
  ["test_run" /* TEST_RUN */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      note: { type: "text" },
      docs: { type: "text" },
      configId: { type: "integer" },
      configurationName: { type: "keyword" },
      milestoneId: { type: "integer" },
      milestoneName: { type: "keyword" },
      stateId: { type: "integer" },
      stateName: { type: "keyword" },
      stateIcon: { type: "keyword" },
      stateColor: { type: "keyword" },
      forecastManual: { type: "integer" },
      forecastAutomated: { type: "float" },
      elapsed: { type: "integer" },
      isCompleted: { type: "boolean" },
      isDeleted: { type: "boolean" },
      completedAt: { type: "date" },
      testRunType: { type: "keyword" },
      tags: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          name: { type: "keyword" }
        }
      }
    }
  },
  ["session" /* SESSION */]: {
    properties: {
      ...baseMapping.properties,
      templateId: { type: "integer" },
      templateName: { type: "keyword" },
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      note: { type: "text" },
      mission: { type: "text" },
      configId: { type: "integer" },
      configurationName: { type: "keyword" },
      milestoneId: { type: "integer" },
      milestoneName: { type: "keyword" },
      stateId: { type: "integer" },
      stateName: { type: "keyword" },
      stateIcon: { type: "keyword" },
      stateColor: { type: "keyword" },
      assignedToId: { type: "keyword" },
      assignedToName: { type: "keyword" },
      assignedToImage: { type: "keyword" },
      estimate: { type: "integer" },
      forecastManual: { type: "integer" },
      forecastAutomated: { type: "float" },
      elapsed: { type: "integer" },
      isCompleted: { type: "boolean" },
      isDeleted: { type: "boolean" },
      completedAt: { type: "date" },
      tags: {
        type: "nested",
        properties: {
          id: { type: "integer" },
          name: { type: "keyword" }
        }
      }
    }
  },
  ["project" /* PROJECT */]: {
    properties: {
      id: { type: "integer" },
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      iconUrl: { type: "keyword" },
      note: { type: "text" },
      docs: { type: "text" },
      isDeleted: { type: "boolean" },
      createdAt: { type: "date" },
      createdById: { type: "keyword" },
      createdByName: { type: "keyword" },
      createdByImage: { type: "keyword" },
      searchableContent: { type: "text" }
    }
  },
  ["issue" /* ISSUE */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      title: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      description: { type: "text" },
      externalId: { type: "keyword" },
      note: { type: "text" },
      url: { type: "keyword" },
      issueSystem: { type: "text" },
      isDeleted: { type: "boolean" }
    }
  },
  ["milestone" /* MILESTONE */]: {
    properties: {
      ...baseMapping.properties,
      name: {
        type: "text",
        analyzer: "standard",
        fields: {
          keyword: {
            type: "keyword",
            ignore_above: 256
          }
        }
      },
      note: { type: "text" },
      docs: { type: "text" },
      milestoneTypeId: { type: "integer" },
      milestoneTypeName: { type: "keyword" },
      milestoneTypeIcon: { type: "keyword" },
      parentId: { type: "integer" },
      parentName: { type: "keyword" },
      dueDate: { type: "date" },
      isCompleted: { type: "boolean" },
      completedAt: { type: "date" },
      isDeleted: { type: "boolean" }
    }
  }
};

// services/issueSearch.ts
init_prismaBase();

// utils/extractTextFromJson.ts
var extractTextFromNode = (node) => {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.text && typeof node.text === "string") return node.text;
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join("");
  }
  return "";
};

// services/issueSearch.ts
function getProjectFromIssue(issue) {
  if (issue.project) {
    return issue.project;
  }
  if (issue.repositoryCases?.[0]?.project) {
    return issue.repositoryCases[0].project;
  }
  if (issue.sessions?.[0]?.project) {
    return issue.sessions[0].project;
  }
  if (issue.testRuns?.[0]?.project) {
    return issue.testRuns[0].project;
  }
  if (issue.sessionResults?.[0]?.session?.project) {
    return issue.sessionResults[0].session.project;
  }
  if (issue.testRunResults?.[0]?.testRun?.project) {
    return issue.testRunResults[0].testRun.project;
  }
  if (issue.testRunStepResults?.[0]?.testRunResult?.testRun?.project) {
    return issue.testRunStepResults[0].testRunResult.testRun.project;
  }
  return null;
}
async function indexIssue(issue, tenantId) {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }
  const indexName = getEntityIndexName("issue" /* ISSUE */, tenantId);
  const projectInfo = getProjectFromIssue(issue);
  if (!projectInfo) {
    console.warn(`Issue ${issue.id} (${issue.name}) has no linked project, skipping indexing`);
    return;
  }
  const noteText = issue.note ? extractTextFromNode(issue.note) : "";
  const searchableContent = [
    issue.name,
    issue.title,
    issue.description || "",
    issue.externalId || "",
    noteText,
    issue.integration?.name || ""
  ].join(" ");
  const document = {
    id: issue.id,
    projectId: projectInfo.id,
    projectName: projectInfo.name,
    projectIconUrl: projectInfo.iconUrl,
    name: issue.name,
    title: issue.title,
    description: issue.description,
    externalId: issue.externalId,
    note: noteText,
    url: issue.data?.url,
    issueSystem: issue.integration?.name || "Unknown",
    isDeleted: issue.isDeleted,
    createdAt: issue.createdAt,
    createdById: issue.createdById,
    createdByName: issue.createdBy.name,
    createdByImage: issue.createdBy.image,
    searchableContent
  };
  await client.index({
    index: indexName,
    id: issue.id.toString(),
    document,
    refresh: true
  });
}
async function syncIssueToElasticsearch(issueId, prismaClient2, tenantId) {
  const prisma2 = prismaClient2 || prisma;
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }
  try {
    const issue = await prisma2.issue.findUnique({
      where: { id: issueId },
      include: {
        createdBy: true,
        integration: true,
        // Include direct project relationship (preferred)
        project: true,
        // Fallback: Check all possible relationships to find project
        repositoryCases: {
          take: 1,
          include: {
            project: true
          }
        },
        sessions: {
          take: 1,
          include: {
            project: true
          }
        },
        testRuns: {
          take: 1,
          include: {
            project: true
          }
        },
        sessionResults: {
          take: 1,
          include: {
            session: {
              include: {
                project: true
              }
            }
          }
        },
        testRunResults: {
          take: 1,
          include: {
            testRun: {
              include: {
                project: true
              }
            }
          }
        },
        testRunStepResults: {
          take: 1,
          include: {
            testRunResult: {
              include: {
                testRun: {
                  include: {
                    project: true
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!issue) {
      console.warn(`Issue ${issueId} not found`);
      return false;
    }
    await indexIssue(issue, tenantId);
    return true;
  } catch (error) {
    console.error(`Failed to sync issue ${issueId}:`, error);
    return false;
  }
}

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
          elasticsearchIndex: config.elasticsearchIndex
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
          elasticsearchIndex: config.elasticsearchIndex
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

// lib/integrations/services/SyncService.ts
var _enhance = null;
async function getEnhance() {
  if (!_enhance) {
    const { enhance } = await import("@zenstackhq/runtime");
    _enhance = enhance;
  }
  return _enhance;
}
var SyncService = class {
  /**
   * Queue a sync job for an integration
   */
  async queueSync(userId, integrationId, options = {}) {
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }
    const jobData = {
      userId,
      integrationId,
      action: "sync",
      data: options,
      tenantId: getCurrentTenantId()
    };
    const jobOptions = {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2e3
      },
      removeOnComplete: true,
      removeOnFail: false
    };
    const job = await syncQueue.add("sync-issues", jobData, jobOptions);
    return job.id || null;
  }
  /**
   * Queue a project-specific sync
   */
  async queueProjectSync(userId, integrationId, projectId, options = {}) {
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }
    const jobData = {
      userId,
      integrationId,
      projectId,
      action: "sync",
      data: options,
      tenantId: getCurrentTenantId()
    };
    const job = await syncQueue.add("sync-project-issues", jobData);
    return job.id || null;
  }
  /**
   * Queue issue creation
   */
  async queueIssueCreate(userId, integrationId, issueData) {
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }
    const jobData = {
      userId,
      integrationId,
      action: "create",
      data: issueData,
      tenantId: getCurrentTenantId()
    };
    const job = await syncQueue.add("create-issue", jobData, {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 1e3
      }
    });
    return job.id || null;
  }
  /**
   * Queue issue update
   */
  async queueIssueUpdate(userId, integrationId, issueId, updateData) {
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }
    const jobData = {
      userId,
      integrationId,
      issueId,
      action: "update",
      data: updateData,
      tenantId: getCurrentTenantId()
    };
    const job = await syncQueue.add("update-issue", jobData);
    return job.id || null;
  }
  /**
   * Queue issue refresh (sync single issue from external system)
   */
  async queueIssueRefresh(userId, integrationId, issueId) {
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }
    const jobData = {
      userId,
      integrationId,
      issueId,
      action: "refresh",
      tenantId: getCurrentTenantId()
    };
    const job = await syncQueue.add("refresh-issue", jobData, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1e3
      },
      removeOnComplete: true,
      removeOnFail: false
    });
    return job.id || null;
  }
  /**
   * Perform immediate sync (used by worker)
   */
  async performSync(userId, integrationId, projectId, options = {}, job, serviceOptions = {}) {
    const prisma2 = serviceOptions.prismaClient || prisma;
    const errors = [];
    let syncedCount = 0;
    try {
      const user = await prisma2.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              rolePermissions: true
            }
          }
        }
      });
      if (!user) {
        throw new Error("User not found");
      }
      const enhance = await getEnhance();
      const userDb = enhance(prisma2, { user }, { kinds: ["delegate"] });
      const integration = await userDb.integration.findUnique({
        where: { id: integrationId },
        include: {
          userIntegrationAuths: {
            where: { userId, isActive: true }
          }
        }
      });
      if (!integration) {
        throw new Error("Integration not found");
      }
      if (integration.authType === "OAUTH2") {
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth) {
          throw new Error("User not authenticated for this integration");
        }
        if (userAuth.tokenExpiresAt && userAuth.tokenExpiresAt < /* @__PURE__ */ new Date()) {
          throw new Error("Authentication token has expired");
        }
      } else if (integration.authType === "API_KEY" || integration.authType === "PERSONAL_ACCESS_TOKEN") {
        if (!integration.credentials) {
          throw new Error("Integration is missing credentials");
        }
      } else if (integration.authType !== "NONE") {
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth && !integration.credentials) {
          throw new Error(
            "No authentication credentials found for this integration"
          );
        }
      }
      const adapter = await integrationManager.getAdapter(
        String(integrationId)
      );
      if (!adapter) {
        throw new Error("Invalid adapter for issue synchronization");
      }
      const totalIssues = await userDb.issue.count({
        where: {
          integrationId,
          ...projectId && { projectId: parseInt(projectId) }
        }
      });
      const BATCH_SIZE = 50;
      let processedCount = 0;
      while (processedCount < totalIssues) {
        const localIssues = await userDb.issue.findMany({
          where: {
            integrationId,
            ...projectId && { projectId: parseInt(projectId) }
          },
          select: {
            id: true,
            externalId: true,
            externalKey: true,
            name: true
          },
          skip: processedCount,
          take: BATCH_SIZE
        });
        for (let i = 0; i < localIssues.length; i++) {
          const localIssue = localIssues[i];
          const globalIndex = processedCount + i;
          try {
            if (job) {
              const progress = Math.round((globalIndex + 1) / totalIssues * 100);
              await job.updateProgress({
                current: globalIndex + 1,
                total: totalIssues,
                percentage: progress,
                message: `Syncing issue ${globalIndex + 1} of ${totalIssues}`
              });
            }
            const issueIdentifier = localIssue.externalId || localIssue.externalKey || localIssue.name;
            if (!issueIdentifier) {
              errors.push(`Issue ${localIssue.id} has no external identifier`);
              continue;
            }
            const issueData = await adapter.syncIssue(issueIdentifier);
            await issueCache.set(integrationId, issueData.id, issueData);
            await this.updateExistingIssue(userDb, integrationId, issueData);
            syncedCount++;
          } catch (error) {
            errors.push(
              `Failed to sync issue ${localIssue.externalKey || localIssue.externalId || localIssue.id}: ${error.message}`
            );
          }
        }
        processedCount += localIssues.length;
        if (processedCount < totalIssues) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      if (options.includeMetadata) {
        try {
          const metadata = {};
          const issueAdapter = adapter;
          if (issueAdapter.getProjects) {
            metadata.projects = await issueAdapter.getProjects();
          }
          if (issueAdapter.getStatuses) {
            metadata.statuses = await issueAdapter.getStatuses();
          }
          if (issueAdapter.getPriorities) {
            metadata.priorities = await issueAdapter.getPriorities();
          }
          await issueCache.setMetadata(integrationId, metadata);
        } catch (error) {
          errors.push(`Failed to fetch metadata: ${error.message}`);
        }
      }
      return { synced: syncedCount, errors };
    } catch (error) {
      errors.push(`Sync failed: ${error.message}`);
      return { synced: syncedCount, errors };
    }
  }
  /**
   * Refresh a single issue from the external system
   */
  async performIssueRefresh(userId, integrationId, externalIssueId, serviceOptions = {}) {
    const prisma2 = serviceOptions.prismaClient || prisma;
    try {
      const user = await prisma2.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              rolePermissions: true
            }
          }
        }
      });
      if (!user) {
        throw new Error("User not found");
      }
      const enhance = await getEnhance();
      const userDb = enhance(prisma2, { user }, { kinds: ["delegate"] });
      const integration = await userDb.integration.findUnique({
        where: { id: integrationId },
        include: {
          userIntegrationAuths: {
            where: { userId, isActive: true }
          }
        }
      });
      if (!integration) {
        throw new Error("Integration not found");
      }
      if (integration.authType === "OAUTH2") {
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth) {
          throw new Error("User not authenticated for this integration");
        }
        if (userAuth.tokenExpiresAt && userAuth.tokenExpiresAt < /* @__PURE__ */ new Date()) {
          throw new Error("Authentication token has expired");
        }
      } else if (integration.authType === "API_KEY" || integration.authType === "PERSONAL_ACCESS_TOKEN") {
        if (!integration.credentials) {
          throw new Error("Integration is missing credentials");
        }
      } else if (integration.authType !== "NONE") {
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth && !integration.credentials) {
          throw new Error(
            "No authentication credentials found for this integration"
          );
        }
      }
      const adapter = await integrationManager.getAdapter(
        String(integrationId)
      );
      if (!adapter) {
        throw new Error("Invalid adapter for issue synchronization");
      }
      const capabilities = adapter.getCapabilities();
      if (!capabilities.syncIssue) {
        throw new Error(
          "This integration does not support syncing individual issues"
        );
      }
      let issueIdForSync = externalIssueId;
      if (integration.provider === "GITHUB") {
        const storedIssue = await userDb.issue.findFirst({
          where: {
            integrationId,
            OR: [
              { externalId: externalIssueId },
              { externalKey: externalIssueId }
            ]
          }
        });
        if (storedIssue?.data) {
          const data = storedIssue.data;
          const customFields = data.customFields;
          if (customFields?._github_owner && customFields?._github_repo) {
            const issueNumber = externalIssueId.replace(/^#/, "");
            issueIdForSync = `${customFields._github_owner}/${customFields._github_repo}#${issueNumber}`;
          }
        }
      }
      const issueData = await adapter.syncIssue(issueIdForSync);
      await issueCache.set(integrationId, issueData.id, issueData);
      await this.updateExistingIssue(userDb, integrationId, issueData);
      return { success: true };
    } catch (error) {
      console.error(`Failed to refresh issue ${externalIssueId}:`, error);
      return { success: false, error: error.message };
    }
  }
  /**
   * Update an existing issue in the local database with fresh data from external system
   */
  async updateExistingIssue(db, integrationId, issueData) {
    const existingIssue = await db.issue.findFirst({
      where: {
        integrationId,
        OR: [
          { externalId: issueData.id },
          { externalId: issueData.key },
          { externalKey: issueData.key },
          { externalKey: issueData.id }
        ]
      }
    });
    if (!existingIssue) {
      const anyIssueWithKey = await db.issue.findFirst({
        where: {
          OR: [
            { externalId: issueData.id },
            { externalId: issueData.key },
            { externalKey: issueData.key },
            { externalKey: issueData.id },
            { name: issueData.key }
          ]
        },
        select: {
          id: true,
          integrationId: true,
          externalId: true,
          externalKey: true,
          name: true
        }
      });
      throw new Error(
        `Issue ${issueData.key || issueData.id} not found in local database. Issues must be created through the UI before they can be synced.`
      );
    }
    const issuePayload = {
      name: issueData.key || issueData.id,
      // Use key if available, otherwise use id
      title: issueData.title,
      description: issueData.description || "",
      status: issueData.status,
      priority: issueData.priority || "medium",
      externalId: issueData.id,
      externalKey: issueData.key,
      externalUrl: issueData.url,
      externalStatus: issueData.status,
      externalData: issueData.customFields || {},
      issueTypeId: issueData.issueType?.id,
      issueTypeName: issueData.issueType?.name,
      issueTypeIconUrl: issueData.issueType?.iconUrl,
      lastSyncedAt: /* @__PURE__ */ new Date()
    };
    await db.issue.update({
      where: { id: existingIssue.id },
      data: issuePayload
    });
    await syncIssueToElasticsearch(existingIssue.id).catch((error) => {
      console.error(
        `Failed to sync issue ${existingIssue.id} to Elasticsearch:`,
        error
      );
    });
  }
};
var syncService = new SyncService();

// workers/syncWorker.ts
var import_node_url = require("node:url");
var import_meta = {};
var processor = async (job) => {
  console.log(`Processing sync job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);
  validateMultiTenantJobData(job.data);
  const prisma2 = getPrismaClientForJob(job.data);
  const serviceOptions = { prismaClient: prisma2 };
  const jobData = job.data;
  switch (job.name) {
    case "sync-issues":
      try {
        const result = await syncService.performSync(
          jobData.userId,
          jobData.integrationId,
          jobData.projectId,
          jobData.data,
          job,
          // Pass job for progress reporting
          serviceOptions
        );
        if (result.errors.length > 0) {
          console.warn(
            `Sync completed with ${result.errors.length} errors:`,
            result.errors
          );
        }
        console.log(`Synced ${result.synced} issues successfully`);
        return result;
      } catch (error) {
        console.error("Failed to sync issues:", error);
        throw error;
      }
    case "sync-project-issues":
      try {
        if (!jobData.projectId) {
          throw new Error("Project ID is required for project sync");
        }
        const result = await syncService.performSync(
          jobData.userId,
          jobData.integrationId,
          jobData.projectId,
          jobData.data,
          job,
          // Pass job for progress reporting
          serviceOptions
        );
        if (result.errors.length > 0) {
          console.warn(
            `Project sync completed with ${result.errors.length} errors:`,
            result.errors
          );
        }
        console.log(`Synced ${result.synced} issues from project successfully`);
        return result;
      } catch (error) {
        console.error("Failed to sync project issues:", error);
        throw error;
      }
    case "refresh-issue":
      try {
        if (!jobData.issueId) {
          throw new Error("Issue ID is required for issue refresh");
        }
        const result = await syncService.performIssueRefresh(
          jobData.userId,
          jobData.integrationId,
          jobData.issueId,
          serviceOptions
        );
        if (!result.success) {
          throw new Error(result.error || "Failed to refresh issue");
        }
        console.log(`Refreshed issue ${jobData.issueId} successfully`);
        return result;
      } catch (error) {
        console.error(`Failed to refresh issue ${jobData.issueId}:`, error);
        throw error;
      }
    case "create-issue":
      try {
        if (!jobData.data) {
          throw new Error("Issue data is required for issue creation");
        }
        console.log("Issue creation not yet implemented in worker");
        return { success: false, error: "Not implemented" };
      } catch (error) {
        console.error("Failed to create issue:", error);
        throw error;
      }
    case "update-issue":
      try {
        if (!jobData.issueId || !jobData.data) {
          throw new Error("Issue ID and data are required for issue update");
        }
        console.log("Issue update not yet implemented in worker");
        return { success: false, error: "Not implemented" };
      } catch (error) {
        console.error("Failed to update issue:", error);
        throw error;
      }
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
};
var worker = null;
var startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("Sync worker starting in MULTI-TENANT mode");
  } else {
    console.log("Sync worker starting in SINGLE-TENANT mode");
  }
  if (valkey_default) {
    worker = new import_bullmq2.Worker(SYNC_QUEUE_NAME, processor, {
      connection: valkey_default,
      concurrency: 1,
      // Process 1 sync job at a time to manage memory usage
      lockDuration: 216e5,
      // 6 hours - allows for very large issue syncs
      maxStalledCount: 1,
      // Reduce automatic stalled job retries
      stalledInterval: 3e5
      // Check for stalled jobs every 5 minutes
    });
    worker.on("completed", (job) => {
      console.log(`Sync job ${job.id} completed successfully.`);
    });
    worker.on("failed", (job, err) => {
      console.error(`Sync job ${job?.id} failed:`, err);
    });
    worker.on("error", (err) => {
      console.error("Sync worker error:", err);
    });
    console.log(`Sync worker started for queue "${SYNC_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Sync worker not started.");
  }
  process.on("SIGINT", async () => {
    console.log("Shutting down sync worker...");
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
  console.log("Sync worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start sync worker:", err);
    process.exit(1);
  });
}
var syncWorker_default = worker;
//# sourceMappingURL=syncWorker.js.map
