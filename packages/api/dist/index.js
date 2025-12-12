'use strict';

// src/client.ts
var TestPlanItError = class extends Error {
  statusCode;
  code;
  details;
  constructor(message, options) {
    super(message);
    this.name = "TestPlanItError";
    this.statusCode = options?.statusCode;
    this.code = options?.code;
    this.details = options?.details;
  }
};
var TestPlanItClient = class {
  baseUrl;
  apiToken;
  timeout;
  maxRetries;
  retryDelay;
  headers;
  // Cache for statuses to avoid repeated lookups
  statusCache = /* @__PURE__ */ new Map();
  constructor(config) {
    if (!config.baseUrl) {
      throw new TestPlanItError("baseUrl is required");
    }
    if (!config.apiToken) {
      throw new TestPlanItError("apiToken is required");
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.timeout = config.timeout ?? 3e4;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1e3;
    this.headers = config.headers ?? {};
  }
  // ============================================================================
  // HTTP Methods
  // ============================================================================
  /**
   * Make an authenticated request to the API
   */
  async request(method, path, options) {
    const url = new URL(path, this.baseUrl);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== void 0) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
      ...this.headers,
      ...options?.headers
    };
    const fetchOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout)
    };
    if (options?.body && method !== "GET") {
      fetchOptions.body = JSON.stringify(options.body);
    }
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString(), fetchOptions);
        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          let errorDetails;
          try {
            const parsed = JSON.parse(errorBody);
            errorMessage = parsed.message || parsed.error || errorMessage;
            errorDetails = parsed;
          } catch {
            if (errorBody) {
              errorMessage = errorBody;
            }
          }
          throw new TestPlanItError(errorMessage, {
            statusCode: response.status,
            details: errorDetails
          });
        }
        const text = await response.text();
        if (!text) {
          return void 0;
        }
        return JSON.parse(text);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (error instanceof TestPlanItError) {
          if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
            throw error;
          }
        }
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * (attempt + 1));
        }
      }
    }
    throw lastError;
  }
  /**
   * Make a multipart form data request
   */
  async requestFormData(method, path, formData, options) {
    const url = new URL(path, this.baseUrl);
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== void 0) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
      ...this.headers
    };
    const fetchOptions = {
      method,
      headers,
      body: formData,
      signal: AbortSignal.timeout(this.timeout)
    };
    const response = await fetch(url.toString(), fetchOptions);
    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.message || parsed.error || errorMessage;
      } catch {
        if (errorBody) {
          errorMessage = errorBody;
        }
      }
      throw new TestPlanItError(errorMessage, { statusCode: response.status });
    }
    const text = await response.text();
    if (!text) {
      return void 0;
    }
    return JSON.parse(text);
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // ============================================================================
  // Projects
  // ============================================================================
  /**
   * Get project by ID
   */
  async getProject(projectId) {
    return this.request("GET", `/api/projects/${projectId}`);
  }
  /**
   * List all projects accessible to the authenticated user
   */
  async listProjects() {
    return this.request("GET", "/api/projects");
  }
  // ============================================================================
  // Statuses
  // ============================================================================
  /**
   * Get all statuses for a project
   */
  async getStatuses(projectId) {
    if (this.statusCache.has(projectId)) {
      return this.statusCache.get(projectId);
    }
    const statuses = await this.request("GET", `/api/projects/${projectId}/statuses`);
    this.statusCache.set(projectId, statuses);
    return statuses;
  }
  /**
   * Get status ID for a normalized status name
   */
  async getStatusId(projectId, status) {
    const statuses = await this.getStatuses(projectId);
    const systemNameMap = {
      passed: ["passed", "pass", "success"],
      failed: ["failed", "fail", "failure", "error"],
      skipped: ["skipped", "skip", "ignored"],
      blocked: ["blocked", "block"],
      pending: ["pending", "untested", "not_run"]
    };
    const systemNames = systemNameMap[status];
    for (const systemName of systemNames) {
      const found = statuses.find(
        (s) => s.systemName.toLowerCase() === systemName || s.name.toLowerCase() === systemName || s.aliases?.toLowerCase().includes(systemName)
      );
      if (found) {
        return found.id;
      }
    }
    return void 0;
  }
  /**
   * Clear the status cache (useful if statuses are updated)
   */
  clearStatusCache() {
    this.statusCache.clear();
  }
  // ============================================================================
  // Test Runs
  // ============================================================================
  /**
   * Create a new test run
   */
  async createTestRun(options) {
    return this.request("POST", "/api/test-runs", {
      body: {
        projectId: options.projectId,
        name: options.name,
        testRunType: options.testRunType ?? "REGULAR",
        configId: options.configId,
        milestoneId: options.milestoneId,
        stateId: options.stateId
      }
    });
  }
  /**
   * Get a test run by ID
   */
  async getTestRun(testRunId) {
    return this.request("GET", `/api/test-runs/${testRunId}`);
  }
  /**
   * Update a test run
   */
  async updateTestRun(testRunId, options) {
    return this.request("PATCH", `/api/test-runs/${testRunId}`, {
      body: options
    });
  }
  /**
   * Complete a test run
   */
  async completeTestRun(testRunId) {
    return this.updateTestRun(testRunId, { isCompleted: true });
  }
  /**
   * List test runs for a project
   */
  async listTestRuns(options) {
    const response = await this.request("GET", "/api/test-runs/completed", {
      query: {
        projectId: options.projectId,
        page: options.page ?? 1,
        pageSize: options.pageSize ?? 25,
        search: options.search,
        runType: options.runType
      }
    });
    return {
      data: response.runs,
      totalCount: response.totalCount,
      pageCount: response.pageCount,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 25
    };
  }
  /**
   * Find a test run by name (exact match)
   */
  async findTestRunByName(projectId, name) {
    const response = await this.listTestRuns({ projectId, search: name, pageSize: 100 });
    return response.data.find((run) => run.name === name);
  }
  // ============================================================================
  // Configurations
  // ============================================================================
  /**
   * List all configurations for a project
   */
  async listConfigurations(projectId) {
    return this.request("GET", `/api/projects/${projectId}/configurations`);
  }
  /**
   * Find a configuration by name (exact match)
   */
  async findConfigurationByName(projectId, name) {
    const configs = await this.listConfigurations(projectId);
    return configs.find((c) => c.name === name);
  }
  // ============================================================================
  // Milestones
  // ============================================================================
  /**
   * List all milestones for a project
   */
  async listMilestones(projectId) {
    return this.request("GET", `/api/projects/${projectId}/milestones`);
  }
  /**
   * Find a milestone by name (exact match)
   */
  async findMilestoneByName(projectId, name) {
    const milestones = await this.listMilestones(projectId);
    return milestones.find((m) => m.name === name);
  }
  // ============================================================================
  // Workflow States
  // ============================================================================
  /**
   * List all workflow states for a project
   */
  async listWorkflowStates(projectId) {
    return this.request("GET", `/api/projects/${projectId}/workflow-states`);
  }
  /**
   * Find a workflow state by name (exact match)
   */
  async findWorkflowStateByName(projectId, name) {
    const states = await this.listWorkflowStates(projectId);
    return states.find((s) => s.name === name);
  }
  // ============================================================================
  // Repository Folders
  // ============================================================================
  /**
   * List all folders for a project
   */
  async listFolders(projectId) {
    return this.request("GET", `/api/projects/${projectId}/folders`);
  }
  /**
   * Find a folder by name (exact match)
   */
  async findFolderByName(projectId, name) {
    const folders = await this.listFolders(projectId);
    return folders.find((f) => f.name === name);
  }
  // ============================================================================
  // Templates
  // ============================================================================
  /**
   * List all templates for a project
   */
  async listTemplates(projectId) {
    return this.request("GET", `/api/projects/${projectId}/templates`);
  }
  /**
   * Find a template by name (exact match)
   */
  async findTemplateByName(projectId, name) {
    const templates = await this.listTemplates(projectId);
    return templates.find((t) => t.name === name);
  }
  // ============================================================================
  // Tags
  // ============================================================================
  /**
   * List all tags for a project
   */
  async listTags(projectId) {
    return this.request("GET", `/api/projects/${projectId}/tags`);
  }
  /**
   * Create a new tag
   * Tags are global (not project-scoped) and can be used across all projects
   */
  async createTag(options) {
    return this.request("POST", "/api/model/tags/create", {
      body: {
        data: {
          name: options.name
        }
      }
    });
  }
  /**
   * Find a tag by name (exact match)
   */
  async findTagByName(projectId, name) {
    const tags = await this.listTags(projectId);
    return tags.find((t) => t.name === name);
  }
  /**
   * Find or create a tag by name
   * Tags are global (not project-scoped)
   */
  async findOrCreateTag(projectId, name) {
    const existing = await this.findTagByName(projectId, name);
    if (existing) {
      return existing;
    }
    return this.createTag({ name });
  }
  /**
   * Resolve multiple tag IDs or names to numeric IDs
   * If a tag name doesn't exist, it will be created automatically
   */
  async resolveTagIds(projectId, tagIdsOrNames) {
    const resolvedIds = [];
    const tags = await this.listTags(projectId);
    for (const idOrName of tagIdsOrNames) {
      if (typeof idOrName === "number") {
        resolvedIds.push(idOrName);
      } else {
        let tag = tags.find((t) => t.name === idOrName);
        if (!tag) {
          tag = await this.createTag({ name: idOrName });
        }
        resolvedIds.push(tag.id);
      }
    }
    return resolvedIds;
  }
  // ============================================================================
  // Test Cases (Repository Cases)
  // ============================================================================
  /**
   * Create a new test case in the repository
   */
  async createTestCase(options) {
    return this.request("POST", "/api/repository-cases", {
      body: {
        projectId: options.projectId,
        folderId: options.folderId,
        templateId: options.templateId,
        name: options.name,
        className: options.className,
        source: options.source ?? "API",
        automated: options.automated ?? true,
        stateId: options.stateId,
        estimate: options.estimate
      }
    });
  }
  /**
   * Get a test case by ID
   */
  async getTestCase(caseId) {
    return this.request("GET", `/api/repository-cases/${caseId}`);
  }
  /**
   * Find test cases matching criteria
   */
  async findTestCases(options) {
    return this.request("GET", "/api/repository-cases", {
      query: {
        projectId: options.projectId,
        name: options.name,
        className: options.className,
        source: options.source
      }
    });
  }
  /**
   * Find or create a test case
   * Searches for an existing case by name/className, creates if not found
   */
  async findOrCreateTestCase(options) {
    const existing = await this.findTestCases({
      projectId: options.projectId,
      name: options.name,
      className: options.className,
      source: options.source
    });
    if (existing.length > 0) {
      return existing[0];
    }
    return this.createTestCase(options);
  }
  // ============================================================================
  // Test Run Cases (linking cases to runs)
  // ============================================================================
  /**
   * Add a test case to a test run
   */
  async addTestCaseToRun(options) {
    return this.request("POST", "/api/test-run-cases", {
      body: {
        testRunId: options.testRunId,
        repositoryCaseId: options.repositoryCaseId,
        assignedToId: options.assignedToId
      }
    });
  }
  /**
   * Get test run cases for a test run
   */
  async getTestRunCases(testRunId) {
    return this.request("GET", `/api/test-runs/${testRunId}/cases`);
  }
  /**
   * Find a test run case by repository case ID
   */
  async findTestRunCase(testRunId, repositoryCaseId) {
    const cases = await this.getTestRunCases(testRunId);
    return cases.find((c) => c.repositoryCaseId === repositoryCaseId);
  }
  /**
   * Find or add a test case to a run
   */
  async findOrAddTestCaseToRun(options) {
    const existing = await this.findTestRunCase(options.testRunId, options.repositoryCaseId);
    if (existing) {
      return existing;
    }
    return this.addTestCaseToRun(options);
  }
  // ============================================================================
  // Test Results
  // ============================================================================
  /**
   * Create a test result
   */
  async createTestResult(options) {
    return this.request("POST", "/api/test-run-results", {
      body: {
        testRunId: options.testRunId,
        testRunCaseId: options.testRunCaseId,
        statusId: options.statusId,
        elapsed: options.elapsed,
        notes: options.notes,
        evidence: options.evidence,
        attempt: options.attempt ?? 1
      }
    });
  }
  /**
   * Get test results for a test run
   */
  async getTestResults(testRunId) {
    return this.request("GET", `/api/test-runs/${testRunId}/results`);
  }
  // ============================================================================
  // Bulk Import
  // ============================================================================
  /**
   * Import test results from files (JUnit, TestNG, etc.)
   * Returns a stream of progress events
   */
  async importTestResults(options, onProgress) {
    const formData = new FormData();
    for (const file of options.files) {
      formData.append("files", file);
    }
    formData.append("projectId", String(options.projectId));
    if (options.format) formData.append("format", options.format);
    if (options.testRunId) formData.append("testRunId", String(options.testRunId));
    if (options.name) formData.append("name", options.name);
    if (options.configId) formData.append("configId", String(options.configId));
    if (options.milestoneId) formData.append("milestoneId", String(options.milestoneId));
    if (options.stateId) formData.append("stateId", String(options.stateId));
    if (options.parentFolderId) formData.append("parentFolderId", String(options.parentFolderId));
    if (options.templateId) formData.append("templateId", String(options.templateId));
    if (options.tagIds) formData.append("tagIds", JSON.stringify(options.tagIds));
    const url = new URL("/api/test-results/import", this.baseUrl);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        ...this.headers
      },
      body: formData
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new TestPlanItError(errorBody || `HTTP ${response.status}`, {
        statusCode: response.status
      });
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new TestPlanItError("No response body");
    }
    const decoder = new TextDecoder();
    let testRunId;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split("\n").filter((line) => line.startsWith("data: "));
      for (const line of lines) {
        const data = line.slice(6);
        try {
          const event = JSON.parse(data);
          onProgress?.(event);
          if (event.complete && event.testRunId) {
            testRunId = event.testRunId;
          }
          if (event.error) {
            throw new TestPlanItError(event.error);
          }
        } catch (e) {
          if (e instanceof TestPlanItError) throw e;
        }
      }
    }
    if (!testRunId) {
      throw new TestPlanItError("Import completed but no test run ID returned");
    }
    return { testRunId };
  }
  // ============================================================================
  // Attachments
  // ============================================================================
  /**
   * Upload an attachment to a test result
   */
  async uploadAttachment(testRunResultId, file, fileName, mimeType) {
    const formData = new FormData();
    if (file instanceof Buffer) {
      formData.append("file", new Blob([file], { type: mimeType }), fileName);
    } else {
      formData.append("file", file, fileName);
    }
    return this.requestFormData("POST", `/api/test-run-results/${testRunResultId}/attachments`, formData);
  }
  // ============================================================================
  // Utilities
  // ============================================================================
  /**
   * Test the API connection
   */
  async testConnection() {
    try {
      await this.request("GET", "/api/health");
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Get the base URL
   */
  getBaseUrl() {
    return this.baseUrl;
  }
};

exports.TestPlanItClient = TestPlanItClient;
exports.TestPlanItError = TestPlanItError;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map