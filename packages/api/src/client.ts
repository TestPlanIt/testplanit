import type {
  TestPlanItClientConfig,
  ApiError,
  TestRun,
  RepositoryCase,
  TestRunCase,
  TestRunResult,
  Status,
  Project,
  Configuration,
  Milestone,
  WorkflowState,
  RepositoryFolder,
  Template,
  Tag,
  Attachment,
  CreateTestRunOptions,
  UpdateTestRunOptions,
  CreateTestCaseOptions,
  CreateTagOptions,
  CreateFolderOptions,
  AddTestCaseToRunOptions,
  CreateTestResultOptions,
  ListTestRunsOptions,
  PaginatedResponse,
  FindTestCaseOptions,
  FindOrCreateTestCaseResult,
  ImportTestResultsOptions,
  ImportProgressEvent,
  NormalizedStatus,
  JUnitTestSuite,
  JUnitTestResult,
  CreateJUnitTestSuiteOptions,
  CreateJUnitTestResultOptions,
  UpdateJUnitTestSuiteOptions,
} from "./types.js";

/**
 * Custom error class for TestPlanIt API errors
 */
export class TestPlanItError extends Error {
  public statusCode?: number;
  public code?: string;
  public details?: unknown;

  constructor(message: string, options?: Partial<ApiError>) {
    super(message);
    this.name = "TestPlanItError";
    this.statusCode = options?.statusCode;
    this.code = options?.code;
    this.details = options?.details;
  }
}

/**
 * ZenStack response wrapper
 */
interface ZenStackResponse<T> {
  data?: T;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * CLI Lookup request
 */
interface LookupRequest {
  projectId?: number;
  type:
    | "project"
    | "state"
    | "config"
    | "milestone"
    | "tag"
    | "folder"
    | "testRun";
  name: string;
  createIfMissing?: boolean;
}

/**
 * CLI Lookup response
 */
interface LookupResponse {
  id: number;
  name: string;
  created?: boolean;
}

/**
 * TestPlanIt API Client
 *
 * Official JavaScript/TypeScript client for interacting with the TestPlanIt API.
 * Uses the ZenStack /api/model endpoints for CRUD operations and /api/cli/lookup for name lookups.
 *
 * @example
 * ```typescript
 * import { TestPlanItClient } from '@testplanit/api';
 *
 * const client = new TestPlanItClient({
 *   baseUrl: 'https://testplanit.example.com',
 *   apiToken: 'tpi_your_token_here',
 * });
 *
 * // Create a test run
 * const testRun = await client.createTestRun({
 *   projectId: 1,
 *   name: 'Automated Test Run',
 * });
 * ```
 */
export class TestPlanItClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly headers: Record<string, string>;

  // Cache for statuses to avoid repeated lookups
  private statusCache: Map<number, Status[]> = new Map();

  constructor(config: TestPlanItClientConfig) {
    if (!config.baseUrl) {
      throw new TestPlanItError("baseUrl is required");
    }
    if (!config.apiToken) {
      throw new TestPlanItError("apiToken is required");
    }

    // Normalize base URL (remove trailing slash)
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
    this.headers = config.headers ?? {};
  }

  // ============================================================================
  // HTTP Methods
  // ============================================================================

  /**
   * Make an authenticated request to the API
   */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    // Add query parameters
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
      ...this.headers,
      ...options?.headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (options?.body && method !== "GET") {
      fetchOptions.body = JSON.stringify(options.body);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString(), fetchOptions);

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          let errorDetails: unknown;

          try {
            const parsed = JSON.parse(errorBody);
            // Extract message from various error response formats
            if (typeof parsed.message === "string") {
              errorMessage = parsed.message;
            } else if (typeof parsed.error === "string") {
              errorMessage = parsed.error;
            } else if (
              typeof parsed.error === "object" &&
              parsed.error !== null
            ) {
              // ZenStack returns { error: { message: 'string', ... } }
              errorMessage =
                parsed.error.message ||
                parsed.error.reason ||
                JSON.stringify(parsed.error);
            } else if (
              parsed.error === undefined &&
              parsed.message === undefined
            ) {
              // Unknown format, include full body
              errorMessage = `HTTP ${response.status}: ${JSON.stringify(
                parsed
              )}`;
            }
            errorDetails = parsed;
          } catch {
            // Body is not JSON
            if (errorBody) {
              // Truncate very long error bodies (like HTML 404 pages)
              errorMessage =
                errorBody.length > 500
                  ? errorBody.slice(0, 500) + "..."
                  : errorBody;
            }
          }

          throw new TestPlanItError(errorMessage, {
            statusCode: response.status,
            details: errorDetails,
          });
        }

        // Handle empty responses
        const text = await response.text();
        if (!text) {
          return undefined as T;
        }

        return JSON.parse(text) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (error instanceof TestPlanItError) {
          if (
            error.statusCode &&
            error.statusCode >= 400 &&
            error.statusCode < 500 &&
            error.statusCode !== 429
          ) {
            throw error;
          }
        }

        // Wait before retrying
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
  private async zenstack<T>(
    model: string,
    operation: string,
    body?: unknown
  ): Promise<T> {
    const readOperations = [
      "findMany",
      "findFirst",
      "findUnique",
      "count",
      "aggregate",
      "groupBy",
    ];
    const postOperations = ["create", "createMany", "upsert"];
    const patchOperations = ["update", "updateMany"];
    const deleteOperations = ["delete", "deleteMany"];

    let response: ZenStackResponse<T>;

    if (readOperations.includes(operation)) {
      // Read operations use GET with ?q= parameter
      if (body) {
        const queryParam = encodeURIComponent(JSON.stringify(body));
        response = await this.request<ZenStackResponse<T>>(
          "GET",
          `/api/model/${model}/${operation}?q=${queryParam}`
        );
      } else {
        response = await this.request<ZenStackResponse<T>>(
          "GET",
          `/api/model/${model}/${operation}`
        );
      }
    } else if (postOperations.includes(operation)) {
      response = await this.request<ZenStackResponse<T>>(
        "POST",
        `/api/model/${model}/${operation}`,
        { body }
      );
    } else if (patchOperations.includes(operation)) {
      response = await this.request<ZenStackResponse<T>>(
        "PATCH",
        `/api/model/${model}/${operation}`,
        { body }
      );
    } else if (deleteOperations.includes(operation)) {
      response = await this.request<ZenStackResponse<T>>(
        "DELETE",
        `/api/model/${model}/${operation}`,
        { body }
      );
    } else {
      // Default to POST for any other operation
      response = await this.request<ZenStackResponse<T>>(
        "POST",
        `/api/model/${model}/${operation}`,
        { body }
      );
    }

    // Handle ZenStack error responses
    if (response && typeof response === "object" && "error" in response) {
      const error = (response as ZenStackResponse<T>).error;
      if (error) {
        // Handle various error formats
        let message: string;
        if (typeof error === "string") {
          message = error;
        } else if (typeof error === "object" && error !== null) {
          message = error.message || JSON.stringify(error);
        } else {
          message = String(error);
        }
        throw new TestPlanItError(message, {
          code:
            typeof error === "object" && error !== null
              ? error.code
              : undefined,
          details: error,
        });
      }
    }

    // Handle case where response is null/undefined
    if (response === null || response === undefined) {
      return undefined as T;
    }

    // Extract data from response
    if (typeof response === "object" && "data" in response) {
      return (response as ZenStackResponse<T>).data as T;
    }

    // If response doesn't have data property, return as-is (shouldn't happen with ZenStack)
    return response as T;
  }

  /**
   * Make a multipart form data request
   */
  private async requestFormData<T>(
    method: string,
    path: string,
    formData: FormData,
    options?: {
      query?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      ...this.headers,
    };

    // Don't set Content-Type - let fetch set it with boundary
    const fetchOptions: RequestInit = {
      method,
      headers,
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
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
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================================
  // CLI Lookup (for name-to-ID resolution)
  // ============================================================================

  /**
   * Look up an entity by name and get its ID
   * Uses the /api/cli/lookup endpoint
   */
  async lookup(options: LookupRequest): Promise<LookupResponse> {
    return this.request<LookupResponse>("POST", "/api/cli/lookup", {
      body: options,
    });
  }

  // ============================================================================
  // Projects
  // ============================================================================

  /**
   * Get project by ID
   */
  async getProject(projectId: number): Promise<Project> {
    return this.zenstack<Project>("projects", "findUnique", {
      where: { id: projectId },
    });
  }

  /**
   * List all projects accessible to the authenticated user
   */
  async listProjects(): Promise<Project[]> {
    return this.zenstack<Project[]>("projects", "findMany", {
      where: { isDeleted: false },
    });
  }

  // ============================================================================
  // Statuses
  // ============================================================================

  /**
   * Get all statuses for a project (with Automation scope)
   */
  async getStatuses(projectId: number): Promise<Status[]> {
    // Check cache first
    if (this.statusCache.has(projectId)) {
      return this.statusCache.get(projectId)!;
    }

    const statuses = await this.zenstack<Status[]>("status", "findMany", {
      where: {
        isEnabled: true,
        isDeleted: false,
        projects: {
          some: {
            projectId: projectId,
          },
        },
        scope: {
          some: {
            scope: {
              name: "Automation",
            },
          },
        },
      },
      include: {
        color: true,
      },
    });

    this.statusCache.set(projectId, statuses);
    return statuses;
  }

  /**
   * Get status ID for a normalized status name
   */
  async getStatusId(
    projectId: number,
    status: NormalizedStatus
  ): Promise<number | undefined> {
    const statuses = await this.getStatuses(projectId);

    // Map normalized status to system names
    const systemNameMap: Record<NormalizedStatus, string[]> = {
      passed: ["passed", "pass", "success"],
      failed: ["failed", "fail", "failure", "error"],
      skipped: ["skipped", "skip", "ignored"],
      blocked: ["blocked", "block"],
      pending: ["pending", "untested", "not_run"],
    };

    const systemNames = systemNameMap[status];

    for (const systemName of systemNames) {
      const found = statuses.find(
        (s) =>
          s.systemName.toLowerCase() === systemName ||
          s.name.toLowerCase() === systemName ||
          s.aliases?.toLowerCase().includes(systemName)
      );
      if (found) {
        return found.id;
      }
    }

    return undefined;
  }

  /**
   * Clear the status cache (useful if statuses are updated)
   */
  clearStatusCache(): void {
    this.statusCache.clear();
  }

  // ============================================================================
  // Test Runs
  // ============================================================================

  /**
   * Create a new test run
   */
  async createTestRun(options: CreateTestRunOptions): Promise<TestRun> {
    // Get the IN_PROGRESS workflow state for RUNS (or first available if none)
    const workflows = await this.zenstack<WorkflowState[]>(
      "workflows",
      "findMany",
      {
        where: {
          isEnabled: true,
          isDeleted: false,
          scope: "RUNS",
          workflowType: "IN_PROGRESS",
          projects: {
            some: { projectId: options.projectId },
          },
        },
        orderBy: { order: "asc" },
        take: 1,
      }
    );

    // Fall back to any RUNS workflow if no IN_PROGRESS one exists
    let defaultStateId = options.stateId || workflows[0]?.id;
    if (!defaultStateId) {
      const fallbackWorkflows = await this.zenstack<WorkflowState[]>(
        "workflows",
        "findMany",
        {
          where: {
            isEnabled: true,
            isDeleted: false,
            scope: "RUNS",
            projects: {
              some: { projectId: options.projectId },
            },
          },
          orderBy: { order: "asc" },
          take: 1,
        }
      );
      defaultStateId = fallbackWorkflows[0]?.id;
    }

    if (!defaultStateId) {
      throw new TestPlanItError(
        "No workflow state found for test runs in this project"
      );
    }

    // ZenStack REST API requires relation syntax (connect) instead of scalar FK fields
    const data: Record<string, unknown> = {
      name: options.name,
      testRunType: options.testRunType ?? "REGULAR",
      project: { connect: { id: options.projectId } },
      state: { connect: { id: defaultStateId } },
    };

    // Add optional relations
    if (options.configId) {
      data.configuration = { connect: { id: options.configId } };
    }
    if (options.milestoneId) {
      data.milestone = { connect: { id: options.milestoneId } };
    }
    if (options.tagIds?.length) {
      data.tags = { connect: options.tagIds.map((id) => ({ id })) };
    }

    return this.zenstack<TestRun>("testRuns", "create", { data });
  }

  /**
   * Get a test run by ID
   */
  async getTestRun(testRunId: number): Promise<TestRun> {
    return this.zenstack<TestRun>("testRuns", "findUnique", {
      where: { id: testRunId },
    });
  }

  /**
   * Update a test run
   */
  async updateTestRun(
    testRunId: number,
    options: UpdateTestRunOptions
  ): Promise<TestRun> {
    return this.zenstack<TestRun>("testRuns", "update", {
      where: { id: testRunId },
      data: options,
    });
  }

  /**
   * Complete a test run
   * Sets isCompleted to true and updates the workflow state to the first DONE state
   * @param testRunId - The test run ID
   * @param projectId - The project ID (required to look up the DONE workflow state)
   */
  async completeTestRun(
    testRunId: number,
    projectId: number
  ): Promise<TestRun> {
    // Get the DONE workflow state for RUNS
    const workflows = await this.zenstack<WorkflowState[]>(
      "workflows",
      "findMany",
      {
        where: {
          isEnabled: true,
          isDeleted: false,
          scope: "RUNS",
          workflowType: "DONE",
          projects: {
            some: { projectId },
          },
        },
        orderBy: { order: "asc" },
        take: 1,
      }
    );

    const doneStateId = workflows[0]?.id;

    // Build update data
    const updateData: UpdateTestRunOptions = { isCompleted: true };
    if (doneStateId) {
      updateData.state = { connect: { id: doneStateId } };
    }

    return this.updateTestRun(testRunId, updateData);
  }

  /**
   * List test runs for a project
   * Uses the dedicated /api/test-runs/completed endpoint
   */
  async listTestRuns(
    options: ListTestRunsOptions
  ): Promise<PaginatedResponse<TestRun>> {
    const response = await this.request<{
      runs: TestRun[];
      totalCount: number;
      pageCount: number;
    }>("GET", "/api/test-runs/completed", {
      query: {
        projectId: options.projectId,
        page: options.page ?? 1,
        pageSize: options.pageSize ?? 25,
        search: options.search,
        runType: options.runType,
      },
    });

    return {
      data: response.runs,
      totalCount: response.totalCount,
      pageCount: response.pageCount,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 25,
    };
  }

  /**
   * Find a test run by name using CLI lookup
   */
  async findTestRunByName(
    projectId: number,
    name: string
  ): Promise<TestRun | undefined> {
    try {
      const result = await this.lookup({ projectId, type: "testRun", name });
      return this.getTestRun(result.id);
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return undefined;
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
  async listConfigurations(projectId: number): Promise<Configuration[]> {
    return this.zenstack<Configuration[]>("configurations", "findMany", {
      where: {
        isDeleted: false,
        isEnabled: true,
      },
    });
  }

  /**
   * Find a configuration by name using CLI lookup
   */
  async findConfigurationByName(
    projectId: number,
    name: string
  ): Promise<Configuration | undefined> {
    try {
      const result = await this.lookup({ type: "config", name });
      return this.zenstack<Configuration>("configurations", "findUnique", {
        where: { id: result.id },
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return undefined;
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
  async listMilestones(projectId: number): Promise<Milestone[]> {
    return this.zenstack<Milestone[]>("milestones", "findMany", {
      where: {
        projectId: projectId,
        isDeleted: false,
      },
    });
  }

  /**
   * Find a milestone by name using CLI lookup
   */
  async findMilestoneByName(
    projectId: number,
    name: string
  ): Promise<Milestone | undefined> {
    try {
      const result = await this.lookup({ projectId, type: "milestone", name });
      return this.zenstack<Milestone>("milestones", "findUnique", {
        where: { id: result.id },
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return undefined;
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
  async listWorkflowStates(projectId: number): Promise<WorkflowState[]> {
    return this.zenstack<WorkflowState[]>("workflows", "findMany", {
      where: {
        isEnabled: true,
        isDeleted: false,
        scope: "RUNS",
        projects: {
          some: { projectId: projectId },
        },
      },
      orderBy: { order: "asc" },
    });
  }

  /**
   * Find a workflow state by name using CLI lookup
   */
  async findWorkflowStateByName(
    projectId: number,
    name: string
  ): Promise<WorkflowState | undefined> {
    try {
      const result = await this.lookup({ projectId, type: "state", name });
      return this.zenstack<WorkflowState>("workflows", "findUnique", {
        where: { id: result.id },
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return undefined;
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
  async listFolders(projectId: number): Promise<RepositoryFolder[]> {
    return this.zenstack<RepositoryFolder[]>("repositoryFolders", "findMany", {
      where: {
        projectId: projectId,
        isDeleted: false,
      },
    });
  }

  /**
   * Find a folder by name using CLI lookup
   */
  async findFolderByName(
    projectId: number,
    name: string
  ): Promise<RepositoryFolder | undefined> {
    try {
      const result = await this.lookup({ projectId, type: "folder", name });
      return this.zenstack<RepositoryFolder>(
        "repositoryFolders",
        "findUnique",
        {
          where: { id: result.id },
        }
      );
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Create a new folder
   */
  async createFolder(options: CreateFolderOptions): Promise<RepositoryFolder> {
    // Get or create repository for the project
    let repositories = await this.zenstack<{ id: number }[]>(
      "repositories",
      "findMany",
      {
        where: {
          projectId: options.projectId,
          isActive: true,
          isDeleted: false,
          isArchived: false,
        },
        take: 1,
      }
    );

    let repositoryId: number;
    if (repositories.length === 0) {
      const newRepo = await this.zenstack<{ id: number }>(
        "repositories",
        "create",
        {
          data: {
            project: { connect: { id: options.projectId } },
            isActive: true,
          },
        }
      );
      repositoryId = newRepo.id;
    } else {
      repositoryId = repositories[0].id;
    }

    const data: Record<string, unknown> = {
      name: options.name,
      project: { connect: { id: options.projectId } },
      repository: { connect: { id: repositoryId } },
    };

    if (options.parentId) {
      data.parent = { connect: { id: options.parentId } };
    }

    return this.zenstack<RepositoryFolder>("repositoryFolders", "create", {
      data,
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
  async findOrCreateFolderPath(
    projectId: number,
    folderPath: string[],
    rootFolderId?: number
  ): Promise<RepositoryFolder> {
    if (folderPath.length === 0) {
      throw new TestPlanItError("Folder path cannot be empty");
    }

    // Get all folders for this project to enable efficient lookups
    const allFolders = await this.listFolders(projectId);

    let currentParentId: number | undefined = rootFolderId;
    let currentFolder: RepositoryFolder | undefined;

    for (const folderName of folderPath) {
      // Look for existing folder with this name under the current parent
      // Handle both null and undefined for parentId comparison
      const existingFolder = allFolders.find((f) => {
        const folderParentId = f.parentId ?? undefined;
        return f.name === folderName && folderParentId === currentParentId;
      });

      if (existingFolder) {
        currentFolder = existingFolder;
        currentParentId = existingFolder.id;
      } else {
        // Create the folder - use try/catch to handle race conditions
        // when multiple workers try to create the same folder simultaneously
        try {
          currentFolder = await this.createFolder({
            projectId,
            name: folderName,
            parentId: currentParentId,
          });
          // Add to allFolders so subsequent iterations can find it
          allFolders.push(currentFolder);
        } catch (error) {
          // If we get a unique constraint error, the folder was created by another worker
          // Re-fetch folders and find the one that was just created
          if (
            error instanceof TestPlanItError &&
            error.message?.includes("Unique constraint failed")
          ) {
            const refreshedFolders = await this.listFolders(projectId);
            const justCreatedFolder = refreshedFolders.find((f) => {
              const folderParentId = f.parentId ?? undefined;
              return (
                f.name === folderName && folderParentId === currentParentId
              );
            });
            if (justCreatedFolder) {
              currentFolder = justCreatedFolder;
              // Update allFolders with refreshed data
              allFolders.length = 0;
              allFolders.push(...refreshedFolders);
            } else {
              throw error; // Re-throw if we still can't find it
            }
          } else {
            throw error;
          }
        }
        currentParentId = currentFolder.id;
      }
    }

    return currentFolder!;
  }

  // ============================================================================
  // Templates
  // ============================================================================

  /**
   * List all templates accessible to the user
   * ZenStack access control handles permission filtering automatically
   */
  async listTemplates(projectId: number): Promise<Template[]> {
    return this.zenstack<Template[]>("templates", "findMany", {
      where: {
        isDeleted: false,
        isEnabled: true,
      },
    });
  }

  /**
   * Find a template by name (case-insensitive)
   * Logs available templates if template not found for debugging
   */
  async findTemplateByName(
    projectId: number,
    name: string
  ): Promise<Template | undefined> {
    const templates = await this.listTemplates(projectId);

    const normalizedName = name.toLowerCase().trim();
    const found = templates.find(
      (t) => t.templateName.toLowerCase().trim() === normalizedName
    );

    // Log error only when template not found
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
  async listTags(projectId: number): Promise<Tag[]> {
    return this.zenstack<Tag[]>("tags", "findMany", {
      where: {
        isDeleted: false,
      },
    });
  }

  /**
   * Create a new tag
   */
  async createTag(options: CreateTagOptions): Promise<Tag> {
    return this.zenstack<Tag>("tags", "create", {
      data: {
        name: options.name,
      },
    });
  }

  /**
   * Find a tag by name using CLI lookup
   */
  async findTagByName(
    projectId: number,
    name: string
  ): Promise<Tag | undefined> {
    try {
      const result = await this.lookup({ type: "tag", name });
      return this.zenstack<Tag>("tags", "findUnique", {
        where: { id: result.id },
      });
    } catch (error) {
      if (error instanceof TestPlanItError && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Find or create a tag by name using CLI lookup with createIfMissing
   */
  async findOrCreateTag(projectId: number, name: string): Promise<Tag> {
    const result = await this.lookup({
      type: "tag",
      name,
      createIfMissing: true,
    });
    return this.zenstack<Tag>("tags", "findUnique", {
      where: { id: result.id },
    });
  }

  /**
   * Resolve multiple tag IDs or names to numeric IDs
   * If a tag name doesn't exist, it will be created automatically
   */
  async resolveTagIds(
    projectId: number,
    tagIdsOrNames: (number | string)[]
  ): Promise<number[]> {
    const resolvedIds: number[] = [];

    for (const idOrName of tagIdsOrNames) {
      if (typeof idOrName === "number") {
        resolvedIds.push(idOrName);
      } else {
        const result = await this.lookup({
          type: "tag",
          name: idOrName,
          createIfMissing: true,
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
  async createTestCase(
    options: CreateTestCaseOptions
  ): Promise<RepositoryCase> {
    // Get or create repository for the project
    let repositories = await this.zenstack<{ id: number }[]>(
      "repositories",
      "findMany",
      {
        where: {
          projectId: options.projectId,
          isActive: true,
          isDeleted: false,
          isArchived: false,
        },
        take: 1,
      }
    );

    let repositoryId: number;
    if (repositories.length === 0) {
      const newRepo = await this.zenstack<{ id: number }>(
        "repositories",
        "create",
        {
          data: {
            project: { connect: { id: options.projectId } },
            isActive: true,
          },
        }
      );
      repositoryId = newRepo.id;
    } else {
      repositoryId = repositories[0].id;
    }

    // Get the workflow state - either provided or default for CASES scope
    let stateId = options.stateId;
    if (!stateId) {
      const workflows = await this.zenstack<{ id: number }[]>(
        "workflows",
        "findMany",
        {
          where: {
            isEnabled: true,
            isDeleted: false,
            scope: "CASES",
            projects: {
              some: { projectId: options.projectId },
            },
          },
          orderBy: { order: "asc" },
          take: 1,
        }
      );

      if (workflows.length === 0) {
        throw new TestPlanItError(
          "No workflow state found for test cases in this project"
        );
      }
      stateId = workflows[0].id;
    }

    // ZenStack REST API requires relation syntax (connect) instead of scalar FK fields
    const data: Record<string, unknown> = {
      name: options.name,
      source: options.source ?? "API",
      automated: options.automated ?? true,
      project: { connect: { id: options.projectId } },
      repository: { connect: { id: repositoryId } },
      folder: { connect: { id: options.folderId } },
      template: { connect: { id: options.templateId } },
      state: { connect: { id: stateId } },
    };
    if (options.className) {
      data.className = options.className;
    }
    if (options.estimate !== undefined) {
      data.estimate = options.estimate;
    }

    return this.zenstack<RepositoryCase>("repositoryCases", "create", { data });
  }

  /**
   * Get a test case by ID
   */
  async getTestCase(caseId: number): Promise<RepositoryCase> {
    return this.zenstack<RepositoryCase>("repositoryCases", "findUnique", {
      where: { id: caseId },
    });
  }

  /**
   * Find test cases matching criteria
   */
  async findTestCases(options: FindTestCaseOptions): Promise<RepositoryCase[]> {
    return this.zenstack<RepositoryCase[]>("repositoryCases", "findMany", {
      where: {
        projectId: options.projectId,
        name: options.name,
        className: options.className,
        source: options.source,
        isDeleted: false,
      },
    });
  }

  /**
   * Find or create a test case
   * First searches for an active (non-deleted) test case in an active folder, then creates if not found.
   * If a matching case exists in a deleted folder, it will be moved to the specified folder.
   *
   * @returns Object containing the test case and an action indicating what happened:
   *   - 'found': An existing test case was found in an active folder
   *   - 'moved': A test case was found in a deleted folder and moved to the specified folder
   *   - 'created': A new test case was created
   */
  async findOrCreateTestCase(
    options: CreateTestCaseOptions
  ): Promise<FindOrCreateTestCaseResult> {
    // First, check for an existing ACTIVE test case (not deleted) in an ACTIVE folder
    const existingCases = await this.zenstack<
      (RepositoryCase & { folder?: { isDeleted: boolean } })[]
    >("repositoryCases", "findMany", {
      where: {
        projectId: options.projectId,
        name: options.name,
        className: options.className || "",
        source: options.source ?? "API",
        isDeleted: false,
      },
      include: {
        folder: {
          select: { isDeleted: true },
        },
      },
      take: 10, // Get a few to check folder status
    });

    // Find a test case in an active (non-deleted) folder
    const caseInActiveFolder = existingCases.find(
      (c) => c.folder && !c.folder.isDeleted
    );

    if (caseInActiveFolder) {
      // Found an active test case in an active folder
      return { testCase: caseInActiveFolder, action: 'found' };
    }

    // Check if there's a test case in a deleted folder that we should move
    const caseInDeletedFolder = existingCases.find(
      (c) => c.folder && c.folder.isDeleted
    );

    if (caseInDeletedFolder) {
      // Move the test case to the new folder
      const movedCase = await this.zenstack<RepositoryCase>("repositoryCases", "update", {
        where: { id: caseInDeletedFolder.id },
        data: {
          folder: { connect: { id: options.folderId } },
        },
      });
      return { testCase: movedCase, action: 'moved' };
    }

    // No active test case found, create a new one
    // Get or create repository for the project
    let repositories = await this.zenstack<{ id: number }[]>(
      "repositories",
      "findMany",
      {
        where: {
          projectId: options.projectId,
          isActive: true,
          isDeleted: false,
          isArchived: false,
        },
        take: 1,
      }
    );

    let repositoryId: number;
    if (repositories.length === 0) {
      const newRepo = await this.zenstack<{ id: number }>(
        "repositories",
        "create",
        {
          data: {
            project: { connect: { id: options.projectId } },
            isActive: true,
          },
        }
      );
      repositoryId = newRepo.id;
    } else {
      repositoryId = repositories[0].id;
    }

    // Get the workflow state - either provided or default for CASES scope
    let stateId = options.stateId;
    if (!stateId) {
      const workflows = await this.zenstack<{ id: number }[]>(
        "workflows",
        "findMany",
        {
          where: {
            isEnabled: true,
            isDeleted: false,
            scope: "CASES",
            projects: {
              some: { projectId: options.projectId },
            },
          },
          orderBy: { order: "asc" },
          take: 1,
        }
      );

      if (workflows.length === 0) {
        throw new TestPlanItError(
          "No workflow state found for test cases in this project"
        );
      }
      stateId = workflows[0].id;
    }

    // ZenStack REST API requires relation syntax (connect) instead of scalar FK fields
    const createData: Record<string, unknown> = {
      name: options.name,
      source: options.source ?? "API",
      automated: options.automated ?? true,
      project: { connect: { id: options.projectId } },
      repository: { connect: { id: repositoryId } },
      folder: { connect: { id: options.folderId } },
      template: { connect: { id: options.templateId } },
      state: { connect: { id: stateId } },
    };
    if (options.className) {
      createData.className = options.className;
    }
    if (options.estimate !== undefined) {
      createData.estimate = options.estimate;
    }

    // Use upsert to handle race conditions - if a deleted record exists with the same
    // composite key, restore it and move to the new folder; otherwise create new
    const createdCase = await this.zenstack<RepositoryCase>("repositoryCases", "upsert", {
      where: {
        projectId_name_className_source: {
          projectId: options.projectId,
          name: options.name,
          className: options.className || "",
          source: options.source ?? "API",
        },
      },
      update: {
        automated: options.automated ?? true,
        isDeleted: false,
        isArchived: false,
        // Also move to the new folder when restoring (in case old folder was deleted)
        folder: { connect: { id: options.folderId } },
      },
      create: createData,
    });
    return { testCase: createdCase, action: 'created' };
  }

  // ============================================================================
  // Test Run Cases (linking cases to runs)
  // ============================================================================

  /**
   * Add a test case to a test run
   */
  async addTestCaseToRun(
    options: AddTestCaseToRunOptions
  ): Promise<TestRunCase> {
    // ZenStack REST API requires relation syntax (connect) instead of scalar FK fields
    const data: Record<string, unknown> = {
      testRun: { connect: { id: options.testRunId } },
      repositoryCase: { connect: { id: options.repositoryCaseId } },
    };
    if (options.assignedToId) {
      data.assignedTo = { connect: { id: options.assignedToId } };
    }
    return this.zenstack<TestRunCase>("testRunCases", "create", { data });
  }

  /**
   * Get test run cases for a test run
   */
  async getTestRunCases(testRunId: number): Promise<TestRunCase[]> {
    return this.zenstack<TestRunCase[]>("testRunCases", "findMany", {
      where: { testRunId: testRunId },
    });
  }

  /**
   * Find a test run case by repository case ID
   */
  async findTestRunCase(
    testRunId: number,
    repositoryCaseId: number
  ): Promise<TestRunCase | undefined> {
    const cases = await this.zenstack<TestRunCase[]>(
      "testRunCases",
      "findMany",
      {
        where: {
          testRunId: testRunId,
          repositoryCaseId: repositoryCaseId,
        },
        take: 1,
      }
    );
    return cases[0];
  }

  /**
   * Find or add a test case to a run
   */
  async findOrAddTestCaseToRun(
    options: AddTestCaseToRunOptions
  ): Promise<TestRunCase> {
    // ZenStack REST API requires relation syntax (connect) instead of scalar FK fields
    const createData: Record<string, unknown> = {
      testRun: { connect: { id: options.testRunId } },
      repositoryCase: { connect: { id: options.repositoryCaseId } },
    };
    if (options.assignedToId) {
      createData.assignedTo = { connect: { id: options.assignedToId } };
    }
    return this.zenstack<TestRunCase>("testRunCases", "upsert", {
      where: {
        testRunId_repositoryCaseId: {
          testRunId: options.testRunId,
          repositoryCaseId: options.repositoryCaseId,
        },
      },
      update: {},
      create: createData,
    });
  }

  // ============================================================================
  // Test Results
  // ============================================================================

  /**
   * Create a test result
   */
  async createTestResult(
    options: CreateTestResultOptions
  ): Promise<TestRunResult> {
    // ZenStack REST API requires relation syntax (connect) instead of scalar FK fields
    const data: Record<string, unknown> = {
      testRun: { connect: { id: options.testRunId } },
      testRunCase: { connect: { id: options.testRunCaseId } },
      status: { connect: { id: options.statusId } },
      attempt: options.attempt ?? 1,
    };
    if (options.elapsed !== undefined) {
      data.elapsed = options.elapsed;
    }
    if (options.notes) {
      data.notes = options.notes;
    }
    if (options.evidence) {
      data.evidence = options.evidence;
    }
    return this.zenstack<TestRunResult>("testRunResults", "create", { data });
  }

  /**
   * Get test results for a test run
   */
  async getTestResults(testRunId: number): Promise<TestRunResult[]> {
    return this.zenstack<TestRunResult[]>("testRunResults", "findMany", {
      where: { testRunId: testRunId },
    });
  }

  // ============================================================================
  // Bulk Import
  // ============================================================================

  /**
   * Import test results from files (JUnit, TestNG, etc.)
   * Returns a stream of progress events
   */
  async importTestResults(
    options: ImportTestResultsOptions,
    onProgress?: (event: ImportProgressEvent) => void
  ): Promise<{ testRunId: number }> {
    const formData = new FormData();

    // Add files
    for (const file of options.files) {
      formData.append("files", file);
    }

    // Add options
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
        ...this.headers,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new TestPlanItError(errorBody || `HTTP ${response.status}`, {
        statusCode: response.status,
      });
    }

    // Handle SSE response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new TestPlanItError("No response body");
    }

    const decoder = new TextDecoder();
    let testRunId: number | undefined;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6); // Remove 'data: '
        if (!data) continue;

        const event = JSON.parse(data) as ImportProgressEvent;
        onProgress?.(event);

        if (event.complete && event.testRunId) {
          testRunId = event.testRunId;
        }

        if (event.error) {
          throw new TestPlanItError(event.error);
        }
      }
    }

    // Process any remaining data in the buffer
    if (buffer.startsWith("data: ")) {
      const data = buffer.slice(6);
      if (data) {
        const event = JSON.parse(data) as ImportProgressEvent;
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
  private async uploadFile(
    file: Blob | Buffer,
    fileName: string,
    mimeType?: string,
    prependString?: string
  ): Promise<{ url: string; key: string }> {
    const formData = new FormData();

    if (file instanceof Buffer) {
      formData.append("file", new Blob([file], { type: mimeType }), fileName);
    } else {
      formData.append("file", file, fileName);
    }
    if (prependString) {
      formData.append("prependString", prependString);
    }

    const response = await this.requestFormData<{
      success: { url: string; key: string };
    }>("POST", "/api/upload-attachment", formData);

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
  async uploadAttachment(
    testRunResultId: number,
    file: Blob | Buffer,
    fileName: string,
    mimeType?: string
  ): Promise<Attachment> {
    // Step 1: Upload file to storage
    const { url } = await this.uploadFile(
      file,
      fileName,
      mimeType,
      `result_${testRunResultId}`
    );

    // Step 2: Create attachment record
    const size = Buffer.isBuffer(file) ? file.length : file.size;
    const data: Record<string, unknown> = {
      url,
      name: fileName,
      mimeType: mimeType || "application/octet-stream",
      size,
      testRunResults: { connect: { id: testRunResultId } },
    };

    return this.zenstack<Attachment>("attachments", "create", { data });
  }

  /**
   * Upload an attachment to a JUnit test result (for automated test runs)
   * Uploads the file to storage and creates an Attachment record linked to the JUnit result
   */
  async uploadJUnitAttachment(
    junitTestResultId: number,
    file: Blob | Buffer,
    fileName: string,
    mimeType?: string,
    note?: string
  ): Promise<Attachment> {
    // Step 1: Upload file to storage
    const { url } = await this.uploadFile(
      file,
      fileName,
      mimeType,
      `junit_${junitTestResultId}`
    );

    // Step 2: Create attachment record linked to JUnit result
    // Uses dedicated endpoint that handles BigInt conversion for size field
    const size = Buffer.isBuffer(file) ? file.length : file.size;
    const response = await this.request<{ data: Attachment }>(
      "POST",
      "/api/junit/attachment",
      {
        body: {
          junitTestResultId,
          url,
          name: fileName,
          mimeType: mimeType || "application/octet-stream",
          size,
          note,
        },
      }
    );

    return response.data;
  }

  // ============================================================================
  // JUnit Test Results (for automated test runs)
  // ============================================================================

  /**
   * Create a JUnit test suite
   * Used for storing test results from automated test frameworks (Mocha, JUnit, etc.)
   */
  async createJUnitTestSuite(
    options: CreateJUnitTestSuiteOptions
  ): Promise<JUnitTestSuite> {
    const data: Record<string, unknown> = {
      name: options.name,
      testRun: { connect: { id: options.testRunId } },
    };

    if (options.time !== undefined) data.time = options.time;
    if (options.tests !== undefined) data.tests = options.tests;
    if (options.failures !== undefined) data.failures = options.failures;
    if (options.errors !== undefined) data.errors = options.errors;
    if (options.skipped !== undefined) data.skipped = options.skipped;
    if (options.assertions !== undefined) data.assertions = options.assertions;
    if (options.timestamp) data.timestamp = options.timestamp;
    if (options.file) data.file = options.file;
    if (options.systemOut) data.systemOut = options.systemOut;
    if (options.systemErr) data.systemErr = options.systemErr;
    if (options.parentId) data.parent = { connect: { id: options.parentId } };

    return this.zenstack<JUnitTestSuite>("jUnitTestSuite", "create", { data });
  }

  /**
   * Create a JUnit test result
   * Used for storing individual test case results within a test suite
   */
  async createJUnitTestResult(
    options: CreateJUnitTestResultOptions
  ): Promise<JUnitTestResult> {
    const data: Record<string, unknown> = {
      type: options.type,
      testSuite: { connect: { id: options.testSuiteId } },
      repositoryCase: { connect: { id: options.repositoryCaseId } },
    };

    if (options.message) data.message = options.message;
    if (options.content) data.content = options.content;
    if (options.statusId) data.status = { connect: { id: options.statusId } };
    if (options.executedAt) data.executedAt = options.executedAt;
    if (options.time !== undefined) data.time = options.time;
    if (options.assertions !== undefined) data.assertions = options.assertions;
    if (options.file) data.file = options.file;
    if (options.line !== undefined) data.line = options.line;
    if (options.systemOut) data.systemOut = options.systemOut;
    if (options.systemErr) data.systemErr = options.systemErr;

    return this.zenstack<JUnitTestResult>("jUnitTestResult", "create", {
      data,
    });
  }

  /**
   * Update a JUnit test suite
   * Used to update statistics (tests, failures, errors, skipped, time) after all results are reported
   */
  async updateJUnitTestSuite(
    testSuiteId: number,
    options: UpdateJUnitTestSuiteOptions
  ): Promise<JUnitTestSuite> {
    const data: Record<string, unknown> = {};

    if (options.time !== undefined) data.time = options.time;
    if (options.tests !== undefined) data.tests = options.tests;
    if (options.failures !== undefined) data.failures = options.failures;
    if (options.errors !== undefined) data.errors = options.errors;
    if (options.skipped !== undefined) data.skipped = options.skipped;
    if (options.assertions !== undefined) data.assertions = options.assertions;
    if (options.systemOut) data.systemOut = options.systemOut;
    if (options.systemErr) data.systemErr = options.systemErr;

    return this.zenstack<JUnitTestSuite>("jUnitTestSuite", "update", {
      where: { id: testSuiteId },
      data,
    });
  }

  /**
   * Get JUnit test suites for a test run
   */
  async getJUnitTestSuites(testRunId: number): Promise<JUnitTestSuite[]> {
    return this.zenstack<JUnitTestSuite[]>("jUnitTestSuite", "findMany", {
      where: { testRunId },
      orderBy: { id: "asc" },
    });
  }

  /**
   * Get JUnit test results for a test suite
   */
  async getJUnitTestResults(testSuiteId: number): Promise<JUnitTestResult[]> {
    return this.zenstack<JUnitTestResult[]>("jUnitTestResult", "findMany", {
      where: { testSuiteId },
      orderBy: { id: "asc" },
    });
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Test the API connection by listing projects
   */
  async testConnection(): Promise<boolean> {
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
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
