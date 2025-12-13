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
            if (typeof parsed.message === "string") {
              errorMessage = parsed.message;
            } else if (typeof parsed.error === "string") {
              errorMessage = parsed.error;
            } else if (typeof parsed.error === "object" && parsed.error !== null) {
              errorMessage = parsed.error.message || parsed.error.reason || JSON.stringify(parsed.error);
            } else if (parsed.error === void 0 && parsed.message === void 0) {
              errorMessage = `HTTP ${response.status}: ${JSON.stringify(
                parsed
              )}`;
            }
            errorDetails = parsed;
          } catch {
            if (errorBody) {
              errorMessage = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
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
   * Make a ZenStack model API request
   * ZenStack endpoints are: /api/model/{model}/{operation}
   * Based on the OpenAPI spec:
   * - Read operations (findMany, findFirst, findUnique, count, aggregate, groupBy) use GET with ?q= parameter
   * - create, createMany, upsert use POST with body
   * - update, updateMany use PATCH with body
   * - delete, deleteMany use DELETE with body
   */
  async zenstack(model, operation, body) {
    const readOperations = [
      "findMany",
      "findFirst",
      "findUnique",
      "count",
      "aggregate",
      "groupBy"
    ];
    const postOperations = ["create", "createMany", "upsert"];
    const patchOperations = ["update", "updateMany"];
    const deleteOperations = ["delete", "deleteMany"];
    let response;
    if (readOperations.includes(operation)) {
      if (body) {
        const queryParam = encodeURIComponent(JSON.stringify(body));
        response = await this.request(
          "GET",
          `/api/model/${model}/${operation}?q=${queryParam}`
        );
      } else {
        response = await this.request(
          "GET",
          `/api/model/${model}/${operation}`
        );
      }
    } else if (postOperations.includes(operation)) {
      response = await this.request(
        "POST",
        `/api/model/${model}/${operation}`,
        { body }
      );
    } else if (patchOperations.includes(operation)) {
      response = await this.request(
        "PATCH",
        `/api/model/${model}/${operation}`,
        { body }
      );
    } else if (deleteOperations.includes(operation)) {
      response = await this.request(
        "DELETE",
        `/api/model/${model}/${operation}`,
        { body }
      );
    } else {
      response = await this.request(
        "POST",
        `/api/model/${model}/${operation}`,
        { body }
      );
    }
    if (response && typeof response === "object" && "error" in response) {
      const error = response.error;
      if (error) {
        let message;
        if (typeof error === "string") {
          message = error;
        } else if (typeof error === "object" && error !== null) {
          message = error.message || JSON.stringify(error);
        } else {
          message = String(error);
        }
        throw new TestPlanItError(message, {
          code: typeof error === "object" && error !== null ? error.code : void 0,
          details: error
        });
      }
    }
    if (response === null || response === void 0) {
      return void 0;
    }
    if (typeof response === "object" && "data" in response) {
      return response.data;
    }
    return response;
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
  // CLI Lookup (for name-to-ID resolution)
  // ============================================================================
  /**
   * Look up an entity by name and get its ID
   * Uses the /api/cli/lookup endpoint
   */
  async lookup(options) {
    return this.request("POST", "/api/cli/lookup", {
      body: options
    });
  }
  // ============================================================================
  // Projects
  // ============================================================================
  /**
   * Get project by ID
   */
  async getProject(projectId) {
    return this.zenstack("projects", "findUnique", {
      where: { id: projectId }
    });
  }
  /**
   * List all projects accessible to the authenticated user
   */
  async listProjects() {
    return this.zenstack("projects", "findMany", {
      where: { isDeleted: false }
    });
  }
  // ============================================================================
  // Statuses
  // ============================================================================
  /**
   * Get all statuses for a project (with Automation scope)
   */
  async getStatuses(projectId) {
    if (this.statusCache.has(projectId)) {
      return this.statusCache.get(projectId);
    }
    const statuses = await this.zenstack("status", "findMany", {
      where: {
        isEnabled: true,
        isDeleted: false,
        projects: {
          some: {
            projectId
          }
        },
        scope: {
          some: {
            scope: {
              name: "Automation"
            }
          }
        }
      },
      include: {
        color: true
      }
    });
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
    const workflows = await this.zenstack(
      "workflows",
      "findMany",
      {
        where: {
          isEnabled: true,
          isDeleted: false,
          scope: "RUNS",
          workflowType: "IN_PROGRESS",
          projects: {
            some: { projectId: options.projectId }
          }
        },
        orderBy: { order: "asc" },
        take: 1
      }
    );
    let defaultStateId = options.stateId || workflows[0]?.id;
    if (!defaultStateId) {
      const fallbackWorkflows = await this.zenstack(
        "workflows",
        "findMany",
        {
          where: {
            isEnabled: true,
            isDeleted: false,
            scope: "RUNS",
            projects: {
              some: { projectId: options.projectId }
            }
          },
          orderBy: { order: "asc" },
          take: 1
        }
      );
      defaultStateId = fallbackWorkflows[0]?.id;
    }
    if (!defaultStateId) {
      throw new TestPlanItError(
        "No workflow state found for test runs in this project"
      );
    }
    const data = {
      name: options.name,
      testRunType: options.testRunType ?? "REGULAR",
      project: { connect: { id: options.projectId } },
      state: { connect: { id: defaultStateId } }
    };
    if (options.configId) {
      data.configuration = { connect: { id: options.configId } };
    }
    if (options.milestoneId) {
      data.milestone = { connect: { id: options.milestoneId } };
    }
    if (options.tagIds?.length) {
      data.tags = { connect: options.tagIds.map((id) => ({ id })) };
    }
    return this.zenstack("testRuns", "create", { data });
  }
  /**
   * Get a test run by ID
   */
  async getTestRun(testRunId) {
    return this.zenstack("testRuns", "findUnique", {
      where: { id: testRunId }
    });
  }
  /**
   * Update a test run
   */
  async updateTestRun(testRunId, options) {
    return this.zenstack("testRuns", "update", {
      where: { id: testRunId },
      data: options
    });
  }
  /**
   * Complete a test run
   * Sets isCompleted to true and updates the workflow state to the first DONE state
   * @param testRunId - The test run ID
   * @param projectId - The project ID (required to look up the DONE workflow state)
   */
  async completeTestRun(testRunId, projectId) {
    const workflows = await this.zenstack(
      "workflows",
      "findMany",
      {
        where: {
          isEnabled: true,
          isDeleted: false,
          scope: "RUNS",
          workflowType: "DONE",
          projects: {
            some: { projectId }
          }
        },
        orderBy: { order: "asc" },
        take: 1
      }
    );
    const doneStateId = workflows[0]?.id;
    const updateData = { isCompleted: true };
    if (doneStateId) {
      updateData.state = { connect: { id: doneStateId } };
    }
    return this.updateTestRun(testRunId, updateData);
  }
  /**
   * List test runs for a project
   * Uses the dedicated /api/test-runs/completed endpoint
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
   * Find a test run by name using CLI lookup
   */
  async findTestRunByName(projectId, name) {
    try {
      const result = await this.lookup({ projectId, type: "testRun", name });
      return this.getTestRun(result.id);
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return void 0;
      }
      throw error;
    }
  }
  // ============================================================================
  // Configurations
  // ============================================================================
  /**
   * List all configurations
   */
  async listConfigurations(projectId) {
    return this.zenstack("configurations", "findMany", {
      where: {
        isDeleted: false,
        isEnabled: true
      }
    });
  }
  /**
   * Find a configuration by name using CLI lookup
   */
  async findConfigurationByName(projectId, name) {
    try {
      const result = await this.lookup({ type: "config", name });
      return this.zenstack("configurations", "findUnique", {
        where: { id: result.id }
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return void 0;
      }
      throw error;
    }
  }
  // ============================================================================
  // Milestones
  // ============================================================================
  /**
   * List all milestones for a project
   */
  async listMilestones(projectId) {
    return this.zenstack("milestones", "findMany", {
      where: {
        projectId,
        isDeleted: false
      }
    });
  }
  /**
   * Find a milestone by name using CLI lookup
   */
  async findMilestoneByName(projectId, name) {
    try {
      const result = await this.lookup({ projectId, type: "milestone", name });
      return this.zenstack("milestones", "findUnique", {
        where: { id: result.id }
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return void 0;
      }
      throw error;
    }
  }
  // ============================================================================
  // Workflow States
  // ============================================================================
  /**
   * List all workflow states for a project (RUNS scope)
   */
  async listWorkflowStates(projectId) {
    return this.zenstack("workflows", "findMany", {
      where: {
        isEnabled: true,
        isDeleted: false,
        scope: "RUNS",
        projects: {
          some: { projectId }
        }
      },
      orderBy: { order: "asc" }
    });
  }
  /**
   * Find a workflow state by name using CLI lookup
   */
  async findWorkflowStateByName(projectId, name) {
    try {
      const result = await this.lookup({ projectId, type: "state", name });
      return this.zenstack("workflows", "findUnique", {
        where: { id: result.id }
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return void 0;
      }
      throw error;
    }
  }
  // ============================================================================
  // Repository Folders
  // ============================================================================
  /**
   * List all folders for a project
   */
  async listFolders(projectId) {
    return this.zenstack("repositoryFolders", "findMany", {
      where: {
        projectId,
        isDeleted: false
      }
    });
  }
  /**
   * Find a folder by name using CLI lookup
   */
  async findFolderByName(projectId, name) {
    try {
      const result = await this.lookup({ projectId, type: "folder", name });
      return this.zenstack(
        "repositoryFolders",
        "findUnique",
        {
          where: { id: result.id }
        }
      );
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return void 0;
      }
      throw error;
    }
  }
  /**
   * Create a new folder
   */
  async createFolder(options) {
    let repositories = await this.zenstack(
      "repositories",
      "findMany",
      {
        where: {
          projectId: options.projectId,
          isActive: true,
          isDeleted: false,
          isArchived: false
        },
        take: 1
      }
    );
    let repositoryId;
    if (repositories.length === 0) {
      const newRepo = await this.zenstack(
        "repositories",
        "create",
        {
          data: {
            project: { connect: { id: options.projectId } },
            isActive: true
          }
        }
      );
      repositoryId = newRepo.id;
    } else {
      repositoryId = repositories[0].id;
    }
    const data = {
      name: options.name,
      project: { connect: { id: options.projectId } },
      repository: { connect: { id: repositoryId } }
    };
    if (options.parentId) {
      data.parent = { connect: { id: options.parentId } };
    }
    return this.zenstack("repositoryFolders", "create", {
      data
    });
  }
  /**
   * Find or create a folder hierarchy from a path
   * @param projectId - The project ID
   * @param folderPath - Array of folder names representing the path (e.g., ['Suite A', 'Suite B', 'Suite C'])
   * @param rootFolderId - Optional root folder ID to start from
   * @returns The final folder in the path
   *
   * @example
   * // Create nested folders: "Custom Text" > "ADM-649" > "@smoke"
   * const folder = await client.findOrCreateFolderPath(projectId, ['Custom Text', 'ADM-649', '@smoke']);
   */
  async findOrCreateFolderPath(projectId, folderPath, rootFolderId) {
    if (folderPath.length === 0) {
      throw new TestPlanItError("Folder path cannot be empty");
    }
    const allFolders = await this.listFolders(projectId);
    let currentParentId = rootFolderId;
    let currentFolder;
    for (const folderName of folderPath) {
      const existingFolder = allFolders.find((f) => {
        const folderParentId = f.parentId ?? void 0;
        return f.name === folderName && folderParentId === currentParentId;
      });
      if (existingFolder) {
        currentFolder = existingFolder;
        currentParentId = existingFolder.id;
      } else {
        try {
          currentFolder = await this.createFolder({
            projectId,
            name: folderName,
            parentId: currentParentId
          });
          allFolders.push(currentFolder);
        } catch (error) {
          if (error instanceof TestPlanItError && error.message?.includes("Unique constraint failed")) {
            const refreshedFolders = await this.listFolders(projectId);
            const justCreatedFolder = refreshedFolders.find((f) => {
              const folderParentId = f.parentId ?? void 0;
              return f.name === folderName && folderParentId === currentParentId;
            });
            if (justCreatedFolder) {
              currentFolder = justCreatedFolder;
              allFolders.length = 0;
              allFolders.push(...refreshedFolders);
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }
        currentParentId = currentFolder.id;
      }
    }
    return currentFolder;
  }
  // ============================================================================
  // Templates
  // ============================================================================
  /**
   * List all templates accessible to the user
   * ZenStack access control handles permission filtering automatically
   */
  async listTemplates(projectId) {
    return this.zenstack("templates", "findMany", {
      where: {
        isDeleted: false,
        isEnabled: true
      }
    });
  }
  /**
   * Find a template by name (case-insensitive)
   * Logs available templates if template not found for debugging
   */
  async findTemplateByName(projectId, name) {
    const templates = await this.listTemplates(projectId);
    const normalizedName = name.toLowerCase().trim();
    const found = templates.find(
      (t) => t.templateName.toLowerCase().trim() === normalizedName
    );
    if (!found) {
      if (templates.length === 0) {
        console.error(
          `[TestPlanIt API] Template "${name}" not found. No templates available. This may be a permissions issue - ensure the API token user has access to templates.`
        );
      } else {
        const availableNames = templates.map((t) => t.templateName);
        console.error(
          `[TestPlanIt API] Template "${name}" not found. Available templates: ${availableNames.join(
            ", "
          )}`
        );
      }
    }
    return found;
  }
  // ============================================================================
  // Tags
  // ============================================================================
  /**
   * List all tags
   */
  async listTags(projectId) {
    return this.zenstack("tags", "findMany", {
      where: {
        isDeleted: false
      }
    });
  }
  /**
   * Create a new tag
   */
  async createTag(options) {
    return this.zenstack("tags", "create", {
      data: {
        name: options.name
      }
    });
  }
  /**
   * Find a tag by name using CLI lookup
   */
  async findTagByName(projectId, name) {
    try {
      const result = await this.lookup({ type: "tag", name });
      return this.zenstack("tags", "findUnique", {
        where: { id: result.id }
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return void 0;
      }
      throw error;
    }
  }
  /**
   * Find or create a tag by name using CLI lookup with createIfMissing
   */
  async findOrCreateTag(projectId, name) {
    const result = await this.lookup({
      type: "tag",
      name,
      createIfMissing: true
    });
    return this.zenstack("tags", "findUnique", {
      where: { id: result.id }
    });
  }
  /**
   * Resolve multiple tag IDs or names to numeric IDs
   * If a tag name doesn't exist, it will be created automatically
   */
  async resolveTagIds(projectId, tagIdsOrNames) {
    const resolvedIds = [];
    for (const idOrName of tagIdsOrNames) {
      if (typeof idOrName === "number") {
        resolvedIds.push(idOrName);
      } else {
        const result = await this.lookup({
          type: "tag",
          name: idOrName,
          createIfMissing: true
        });
        resolvedIds.push(result.id);
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
    let repositories = await this.zenstack(
      "repositories",
      "findMany",
      {
        where: {
          projectId: options.projectId,
          isActive: true,
          isDeleted: false,
          isArchived: false
        },
        take: 1
      }
    );
    let repositoryId;
    if (repositories.length === 0) {
      const newRepo = await this.zenstack(
        "repositories",
        "create",
        {
          data: {
            project: { connect: { id: options.projectId } },
            isActive: true
          }
        }
      );
      repositoryId = newRepo.id;
    } else {
      repositoryId = repositories[0].id;
    }
    let stateId = options.stateId;
    if (!stateId) {
      const workflows = await this.zenstack(
        "workflows",
        "findMany",
        {
          where: {
            isEnabled: true,
            isDeleted: false,
            scope: "CASES",
            projects: {
              some: { projectId: options.projectId }
            }
          },
          orderBy: { order: "asc" },
          take: 1
        }
      );
      if (workflows.length === 0) {
        throw new TestPlanItError(
          "No workflow state found for test cases in this project"
        );
      }
      stateId = workflows[0].id;
    }
    const data = {
      name: options.name,
      source: options.source ?? "API",
      automated: options.automated ?? true,
      project: { connect: { id: options.projectId } },
      repository: { connect: { id: repositoryId } },
      folder: { connect: { id: options.folderId } },
      template: { connect: { id: options.templateId } },
      state: { connect: { id: stateId } }
    };
    if (options.className) {
      data.className = options.className;
    }
    if (options.estimate !== void 0) {
      data.estimate = options.estimate;
    }
    return this.zenstack("repositoryCases", "create", { data });
  }
  /**
   * Get a test case by ID
   */
  async getTestCase(caseId) {
    return this.zenstack("repositoryCases", "findUnique", {
      where: { id: caseId }
    });
  }
  /**
   * Find test cases matching criteria
   */
  async findTestCases(options) {
    return this.zenstack("repositoryCases", "findMany", {
      where: {
        projectId: options.projectId,
        name: options.name,
        className: options.className,
        source: options.source,
        isDeleted: false
      }
    });
  }
  /**
   * Find or create a test case
   * First searches for an active (non-deleted) test case in an active folder, then creates if not found.
   * If a matching case exists in a deleted folder, it will be moved to the specified folder.
   */
  async findOrCreateTestCase(options) {
    const existingCases = await this.zenstack("repositoryCases", "findMany", {
      where: {
        projectId: options.projectId,
        name: options.name,
        className: options.className || "",
        source: options.source ?? "API",
        isDeleted: false
      },
      include: {
        folder: {
          select: { isDeleted: true }
        }
      },
      take: 10
      // Get a few to check folder status
    });
    const caseInActiveFolder = existingCases.find(
      (c) => c.folder && !c.folder.isDeleted
    );
    if (caseInActiveFolder) {
      return caseInActiveFolder;
    }
    const caseInDeletedFolder = existingCases.find(
      (c) => c.folder && c.folder.isDeleted
    );
    if (caseInDeletedFolder) {
      return this.zenstack("repositoryCases", "update", {
        where: { id: caseInDeletedFolder.id },
        data: {
          folder: { connect: { id: options.folderId } }
        }
      });
    }
    let repositories = await this.zenstack(
      "repositories",
      "findMany",
      {
        where: {
          projectId: options.projectId,
          isActive: true,
          isDeleted: false,
          isArchived: false
        },
        take: 1
      }
    );
    let repositoryId;
    if (repositories.length === 0) {
      const newRepo = await this.zenstack(
        "repositories",
        "create",
        {
          data: {
            project: { connect: { id: options.projectId } },
            isActive: true
          }
        }
      );
      repositoryId = newRepo.id;
    } else {
      repositoryId = repositories[0].id;
    }
    let stateId = options.stateId;
    if (!stateId) {
      const workflows = await this.zenstack(
        "workflows",
        "findMany",
        {
          where: {
            isEnabled: true,
            isDeleted: false,
            scope: "CASES",
            projects: {
              some: { projectId: options.projectId }
            }
          },
          orderBy: { order: "asc" },
          take: 1
        }
      );
      if (workflows.length === 0) {
        throw new TestPlanItError(
          "No workflow state found for test cases in this project"
        );
      }
      stateId = workflows[0].id;
    }
    const createData = {
      name: options.name,
      source: options.source ?? "API",
      automated: options.automated ?? true,
      project: { connect: { id: options.projectId } },
      repository: { connect: { id: repositoryId } },
      folder: { connect: { id: options.folderId } },
      template: { connect: { id: options.templateId } },
      state: { connect: { id: stateId } }
    };
    if (options.className) {
      createData.className = options.className;
    }
    if (options.estimate !== void 0) {
      createData.estimate = options.estimate;
    }
    return this.zenstack("repositoryCases", "upsert", {
      where: {
        projectId_name_className_source: {
          projectId: options.projectId,
          name: options.name,
          className: options.className || "",
          source: options.source ?? "API"
        }
      },
      update: {
        automated: options.automated ?? true,
        isDeleted: false,
        isArchived: false,
        // Also move to the new folder when restoring (in case old folder was deleted)
        folder: { connect: { id: options.folderId } }
      },
      create: createData
    });
  }
  // ============================================================================
  // Test Run Cases (linking cases to runs)
  // ============================================================================
  /**
   * Add a test case to a test run
   */
  async addTestCaseToRun(options) {
    const data = {
      testRun: { connect: { id: options.testRunId } },
      repositoryCase: { connect: { id: options.repositoryCaseId } }
    };
    if (options.assignedToId) {
      data.assignedTo = { connect: { id: options.assignedToId } };
    }
    return this.zenstack("testRunCases", "create", { data });
  }
  /**
   * Get test run cases for a test run
   */
  async getTestRunCases(testRunId) {
    return this.zenstack("testRunCases", "findMany", {
      where: { testRunId }
    });
  }
  /**
   * Find a test run case by repository case ID
   */
  async findTestRunCase(testRunId, repositoryCaseId) {
    const cases = await this.zenstack(
      "testRunCases",
      "findMany",
      {
        where: {
          testRunId,
          repositoryCaseId
        },
        take: 1
      }
    );
    return cases[0];
  }
  /**
   * Find or add a test case to a run
   */
  async findOrAddTestCaseToRun(options) {
    const createData = {
      testRun: { connect: { id: options.testRunId } },
      repositoryCase: { connect: { id: options.repositoryCaseId } }
    };
    if (options.assignedToId) {
      createData.assignedTo = { connect: { id: options.assignedToId } };
    }
    return this.zenstack("testRunCases", "upsert", {
      where: {
        testRunId_repositoryCaseId: {
          testRunId: options.testRunId,
          repositoryCaseId: options.repositoryCaseId
        }
      },
      update: {},
      create: createData
    });
  }
  // ============================================================================
  // Test Results
  // ============================================================================
  /**
   * Create a test result
   */
  async createTestResult(options) {
    const data = {
      testRun: { connect: { id: options.testRunId } },
      testRunCase: { connect: { id: options.testRunCaseId } },
      status: { connect: { id: options.statusId } },
      attempt: options.attempt ?? 1
    };
    if (options.elapsed !== void 0) {
      data.elapsed = options.elapsed;
    }
    if (options.notes) {
      data.notes = options.notes;
    }
    if (options.evidence) {
      data.evidence = options.evidence;
    }
    return this.zenstack("testRunResults", "create", { data });
  }
  /**
   * Get test results for a test run
   */
  async getTestResults(testRunId) {
    return this.zenstack("testRunResults", "findMany", {
      where: { testRunId }
    });
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
    if (options.testRunId)
      formData.append("testRunId", String(options.testRunId));
    if (options.name) formData.append("name", options.name);
    if (options.configId) formData.append("configId", String(options.configId));
    if (options.milestoneId)
      formData.append("milestoneId", String(options.milestoneId));
    if (options.stateId) formData.append("stateId", String(options.stateId));
    if (options.parentFolderId)
      formData.append("parentFolderId", String(options.parentFolderId));
    if (options.templateId)
      formData.append("templateId", String(options.templateId));
    if (options.tagIds) {
      for (const tagId of options.tagIds) {
        formData.append("tagIds", String(tagId));
      }
    }
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
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (!data) continue;
        const event = JSON.parse(data);
        onProgress?.(event);
        if (event.complete && event.testRunId) {
          testRunId = event.testRunId;
        }
        if (event.error) {
          throw new TestPlanItError(event.error);
        }
      }
    }
    if (buffer.startsWith("data: ")) {
      const data = buffer.slice(6);
      if (data) {
        const event = JSON.parse(data);
        onProgress?.(event);
        if (event.complete && event.testRunId) {
          testRunId = event.testRunId;
        }
        if (event.error) {
          throw new TestPlanItError(event.error);
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
   * Upload file to storage
   * Uses the /api/upload-attachment endpoint to upload to S3/MinIO
   */
  async uploadFile(file, fileName, mimeType, prependString) {
    const formData = new FormData();
    if (file instanceof Buffer) {
      formData.append("file", new Blob([file], { type: mimeType }), fileName);
    } else {
      formData.append("file", file, fileName);
    }
    if (prependString) {
      formData.append("prependString", prependString);
    }
    const response = await this.requestFormData("POST", "/api/upload-attachment", formData);
    if (!response || !response.success || !response.success.url) {
      throw new TestPlanItError(
        "Upload failed: API returned an empty or invalid response"
      );
    }
    return response.success;
  }
  /**
   * Upload an attachment to a test run result (for regular test runs)
   * Uploads the file to storage and creates an Attachment record
   */
  async uploadAttachment(testRunResultId, file, fileName, mimeType) {
    const { url } = await this.uploadFile(
      file,
      fileName,
      mimeType,
      `result_${testRunResultId}`
    );
    const size = Buffer.isBuffer(file) ? file.length : file.size;
    const data = {
      url,
      name: fileName,
      mimeType: mimeType || "application/octet-stream",
      size,
      testRunResults: { connect: { id: testRunResultId } }
    };
    return this.zenstack("attachments", "create", { data });
  }
  /**
   * Upload an attachment to a JUnit test result (for automated test runs)
   * Uploads the file to storage and creates an Attachment record linked to the JUnit result
   */
  async uploadJUnitAttachment(junitTestResultId, file, fileName, mimeType) {
    const { url } = await this.uploadFile(
      file,
      fileName,
      mimeType,
      `junit_${junitTestResultId}`
    );
    const size = BigInt(Buffer.isBuffer(file) ? file.length : file.size);
    const data = {
      url,
      name: fileName,
      mimeType: mimeType || "application/octet-stream",
      size,
      junitTestResult: { connect: { id: junitTestResultId } }
    };
    return this.zenstack("attachments", "create", { data });
  }
  // ============================================================================
  // JUnit Test Results (for automated test runs)
  // ============================================================================
  /**
   * Create a JUnit test suite
   * Used for storing test results from automated test frameworks (Mocha, JUnit, etc.)
   */
  async createJUnitTestSuite(options) {
    const data = {
      name: options.name,
      testRun: { connect: { id: options.testRunId } }
    };
    if (options.time !== void 0) data.time = options.time;
    if (options.tests !== void 0) data.tests = options.tests;
    if (options.failures !== void 0) data.failures = options.failures;
    if (options.errors !== void 0) data.errors = options.errors;
    if (options.skipped !== void 0) data.skipped = options.skipped;
    if (options.assertions !== void 0) data.assertions = options.assertions;
    if (options.timestamp) data.timestamp = options.timestamp;
    if (options.file) data.file = options.file;
    if (options.systemOut) data.systemOut = options.systemOut;
    if (options.systemErr) data.systemErr = options.systemErr;
    if (options.parentId) data.parent = { connect: { id: options.parentId } };
    return this.zenstack("jUnitTestSuite", "create", { data });
  }
  /**
   * Create a JUnit test result
   * Used for storing individual test case results within a test suite
   */
  async createJUnitTestResult(options) {
    const data = {
      type: options.type,
      testSuite: { connect: { id: options.testSuiteId } },
      repositoryCase: { connect: { id: options.repositoryCaseId } }
    };
    if (options.message) data.message = options.message;
    if (options.content) data.content = options.content;
    if (options.statusId) data.status = { connect: { id: options.statusId } };
    if (options.executedAt) data.executedAt = options.executedAt;
    if (options.time !== void 0) data.time = options.time;
    if (options.assertions !== void 0) data.assertions = options.assertions;
    if (options.file) data.file = options.file;
    if (options.line !== void 0) data.line = options.line;
    if (options.systemOut) data.systemOut = options.systemOut;
    if (options.systemErr) data.systemErr = options.systemErr;
    return this.zenstack("jUnitTestResult", "create", {
      data
    });
  }
  /**
   * Update a JUnit test suite
   * Used to update statistics (tests, failures, errors, skipped, time) after all results are reported
   */
  async updateJUnitTestSuite(testSuiteId, options) {
    const data = {};
    if (options.time !== void 0) data.time = options.time;
    if (options.tests !== void 0) data.tests = options.tests;
    if (options.failures !== void 0) data.failures = options.failures;
    if (options.errors !== void 0) data.errors = options.errors;
    if (options.skipped !== void 0) data.skipped = options.skipped;
    if (options.assertions !== void 0) data.assertions = options.assertions;
    if (options.systemOut) data.systemOut = options.systemOut;
    if (options.systemErr) data.systemErr = options.systemErr;
    return this.zenstack("jUnitTestSuite", "update", {
      where: { id: testSuiteId },
      data
    });
  }
  /**
   * Get JUnit test suites for a test run
   */
  async getJUnitTestSuites(testRunId) {
    return this.zenstack("jUnitTestSuite", "findMany", {
      where: { testRunId },
      orderBy: { id: "asc" }
    });
  }
  /**
   * Get JUnit test results for a test suite
   */
  async getJUnitTestResults(testSuiteId) {
    return this.zenstack("jUnitTestResult", "findMany", {
      where: { testSuiteId },
      orderBy: { id: "asc" }
    });
  }
  // ============================================================================
  // Utilities
  // ============================================================================
  /**
   * Test the API connection by listing projects
   */
  async testConnection() {
    try {
      await this.listProjects();
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

export { TestPlanItClient, TestPlanItError };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map