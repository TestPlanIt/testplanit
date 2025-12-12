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
  CreateTestRunOptions,
  UpdateTestRunOptions,
  CreateTestCaseOptions,
  CreateTagOptions,
  AddTestCaseToRunOptions,
  CreateTestResultOptions,
  ListTestRunsOptions,
  PaginatedResponse,
  FindTestCaseOptions,
  ImportTestResultsOptions,
  ImportProgressEvent,
  NormalizedStatus,
} from './types.js';

/**
 * Custom error class for TestPlanIt API errors
 */
export class TestPlanItError extends Error {
  public statusCode?: number;
  public code?: string;
  public details?: unknown;

  constructor(message: string, options?: Partial<ApiError>) {
    super(message);
    this.name = 'TestPlanItError';
    this.statusCode = options?.statusCode;
    this.code = options?.code;
    this.details = options?.details;
  }
}

/**
 * TestPlanIt API Client
 *
 * Official JavaScript/TypeScript client for interacting with the TestPlanIt API.
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
      throw new TestPlanItError('baseUrl is required');
    }
    if (!config.apiToken) {
      throw new TestPlanItError('apiToken is required');
    }

    // Normalize base URL (remove trailing slash)
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
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
      'Content-Type': 'application/json',
      ...this.headers,
      ...options?.headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (options?.body && method !== 'GET') {
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
            errorMessage = parsed.message || parsed.error || errorMessage;
            errorDetails = parsed;
          } catch {
            // Body is not JSON
            if (errorBody) {
              errorMessage = errorBody;
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
          if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
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
  // Projects
  // ============================================================================

  /**
   * Get project by ID
   */
  async getProject(projectId: number): Promise<Project> {
    return this.request<Project>('GET', `/api/projects/${projectId}`);
  }

  /**
   * List all projects accessible to the authenticated user
   */
  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>('GET', '/api/projects');
  }

  // ============================================================================
  // Statuses
  // ============================================================================

  /**
   * Get all statuses for a project
   */
  async getStatuses(projectId: number): Promise<Status[]> {
    // Check cache first
    if (this.statusCache.has(projectId)) {
      return this.statusCache.get(projectId)!;
    }

    const statuses = await this.request<Status[]>('GET', `/api/projects/${projectId}/statuses`);
    this.statusCache.set(projectId, statuses);
    return statuses;
  }

  /**
   * Get status ID for a normalized status name
   */
  async getStatusId(projectId: number, status: NormalizedStatus): Promise<number | undefined> {
    const statuses = await this.getStatuses(projectId);

    // Map normalized status to system names
    const systemNameMap: Record<NormalizedStatus, string[]> = {
      passed: ['passed', 'pass', 'success'],
      failed: ['failed', 'fail', 'failure', 'error'],
      skipped: ['skipped', 'skip', 'ignored'],
      blocked: ['blocked', 'block'],
      pending: ['pending', 'untested', 'not_run'],
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
    return this.request<TestRun>('POST', '/api/test-runs', {
      body: {
        projectId: options.projectId,
        name: options.name,
        testRunType: options.testRunType ?? 'REGULAR',
        configId: options.configId,
        milestoneId: options.milestoneId,
        stateId: options.stateId,
      },
    });
  }

  /**
   * Get a test run by ID
   */
  async getTestRun(testRunId: number): Promise<TestRun> {
    return this.request<TestRun>('GET', `/api/test-runs/${testRunId}`);
  }

  /**
   * Update a test run
   */
  async updateTestRun(testRunId: number, options: UpdateTestRunOptions): Promise<TestRun> {
    return this.request<TestRun>('PATCH', `/api/test-runs/${testRunId}`, {
      body: options,
    });
  }

  /**
   * Complete a test run
   */
  async completeTestRun(testRunId: number): Promise<TestRun> {
    return this.updateTestRun(testRunId, { isCompleted: true });
  }

  /**
   * List test runs for a project
   */
  async listTestRuns(options: ListTestRunsOptions): Promise<PaginatedResponse<TestRun>> {
    const response = await this.request<{
      runs: TestRun[];
      totalCount: number;
      pageCount: number;
    }>('GET', '/api/test-runs/completed', {
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
   * Find a test run by name (exact match)
   */
  async findTestRunByName(projectId: number, name: string): Promise<TestRun | undefined> {
    const response = await this.listTestRuns({ projectId, search: name, pageSize: 100 });
    return response.data.find((run) => run.name === name);
  }

  // ============================================================================
  // Configurations
  // ============================================================================

  /**
   * List all configurations for a project
   */
  async listConfigurations(projectId: number): Promise<Configuration[]> {
    return this.request<Configuration[]>('GET', `/api/projects/${projectId}/configurations`);
  }

  /**
   * Find a configuration by name (exact match)
   */
  async findConfigurationByName(projectId: number, name: string): Promise<Configuration | undefined> {
    const configs = await this.listConfigurations(projectId);
    return configs.find((c) => c.name === name);
  }

  // ============================================================================
  // Milestones
  // ============================================================================

  /**
   * List all milestones for a project
   */
  async listMilestones(projectId: number): Promise<Milestone[]> {
    return this.request<Milestone[]>('GET', `/api/projects/${projectId}/milestones`);
  }

  /**
   * Find a milestone by name (exact match)
   */
  async findMilestoneByName(projectId: number, name: string): Promise<Milestone | undefined> {
    const milestones = await this.listMilestones(projectId);
    return milestones.find((m) => m.name === name);
  }

  // ============================================================================
  // Workflow States
  // ============================================================================

  /**
   * List all workflow states for a project
   */
  async listWorkflowStates(projectId: number): Promise<WorkflowState[]> {
    return this.request<WorkflowState[]>('GET', `/api/projects/${projectId}/workflow-states`);
  }

  /**
   * Find a workflow state by name (exact match)
   */
  async findWorkflowStateByName(projectId: number, name: string): Promise<WorkflowState | undefined> {
    const states = await this.listWorkflowStates(projectId);
    return states.find((s) => s.name === name);
  }

  // ============================================================================
  // Repository Folders
  // ============================================================================

  /**
   * List all folders for a project
   */
  async listFolders(projectId: number): Promise<RepositoryFolder[]> {
    return this.request<RepositoryFolder[]>('GET', `/api/projects/${projectId}/folders`);
  }

  /**
   * Find a folder by name (exact match)
   */
  async findFolderByName(projectId: number, name: string): Promise<RepositoryFolder | undefined> {
    const folders = await this.listFolders(projectId);
    return folders.find((f) => f.name === name);
  }

  // ============================================================================
  // Templates
  // ============================================================================

  /**
   * List all templates for a project
   */
  async listTemplates(projectId: number): Promise<Template[]> {
    return this.request<Template[]>('GET', `/api/projects/${projectId}/templates`);
  }

  /**
   * Find a template by name (exact match)
   */
  async findTemplateByName(projectId: number, name: string): Promise<Template | undefined> {
    const templates = await this.listTemplates(projectId);
    return templates.find((t) => t.name === name);
  }

  // ============================================================================
  // Tags
  // ============================================================================

  /**
   * List all tags for a project
   */
  async listTags(projectId: number): Promise<Tag[]> {
    return this.request<Tag[]>('GET', `/api/projects/${projectId}/tags`);
  }

  /**
   * Create a new tag
   * Tags are global (not project-scoped) and can be used across all projects
   */
  async createTag(options: CreateTagOptions): Promise<Tag> {
    return this.request<Tag>('POST', '/api/model/tags/create', {
      body: {
        data: {
          name: options.name,
        },
      },
    });
  }

  /**
   * Find a tag by name (exact match)
   */
  async findTagByName(projectId: number, name: string): Promise<Tag | undefined> {
    const tags = await this.listTags(projectId);
    return tags.find((t) => t.name === name);
  }

  /**
   * Find or create a tag by name
   * Tags are global (not project-scoped)
   */
  async findOrCreateTag(projectId: number, name: string): Promise<Tag> {
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
  async resolveTagIds(projectId: number, tagIdsOrNames: (number | string)[]): Promise<number[]> {
    const resolvedIds: number[] = [];
    const tags = await this.listTags(projectId);

    for (const idOrName of tagIdsOrNames) {
      if (typeof idOrName === 'number') {
        resolvedIds.push(idOrName);
      } else {
        let tag = tags.find((t) => t.name === idOrName);
        if (!tag) {
          // Create the tag if it doesn't exist
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
  async createTestCase(options: CreateTestCaseOptions): Promise<RepositoryCase> {
    return this.request<RepositoryCase>('POST', '/api/repository-cases', {
      body: {
        projectId: options.projectId,
        folderId: options.folderId,
        templateId: options.templateId,
        name: options.name,
        className: options.className,
        source: options.source ?? 'API',
        automated: options.automated ?? true,
        stateId: options.stateId,
        estimate: options.estimate,
      },
    });
  }

  /**
   * Get a test case by ID
   */
  async getTestCase(caseId: number): Promise<RepositoryCase> {
    return this.request<RepositoryCase>('GET', `/api/repository-cases/${caseId}`);
  }

  /**
   * Find test cases matching criteria
   */
  async findTestCases(options: FindTestCaseOptions): Promise<RepositoryCase[]> {
    return this.request<RepositoryCase[]>('GET', '/api/repository-cases', {
      query: {
        projectId: options.projectId,
        name: options.name,
        className: options.className,
        source: options.source,
      },
    });
  }

  /**
   * Find or create a test case
   * Searches for an existing case by name/className, creates if not found
   */
  async findOrCreateTestCase(options: CreateTestCaseOptions): Promise<RepositoryCase> {
    // Try to find existing
    const existing = await this.findTestCases({
      projectId: options.projectId,
      name: options.name,
      className: options.className,
      source: options.source,
    });

    if (existing.length > 0) {
      return existing[0];
    }

    // Create new
    return this.createTestCase(options);
  }

  // ============================================================================
  // Test Run Cases (linking cases to runs)
  // ============================================================================

  /**
   * Add a test case to a test run
   */
  async addTestCaseToRun(options: AddTestCaseToRunOptions): Promise<TestRunCase> {
    return this.request<TestRunCase>('POST', '/api/test-run-cases', {
      body: {
        testRunId: options.testRunId,
        repositoryCaseId: options.repositoryCaseId,
        assignedToId: options.assignedToId,
      },
    });
  }

  /**
   * Get test run cases for a test run
   */
  async getTestRunCases(testRunId: number): Promise<TestRunCase[]> {
    return this.request<TestRunCase[]>('GET', `/api/test-runs/${testRunId}/cases`);
  }

  /**
   * Find a test run case by repository case ID
   */
  async findTestRunCase(testRunId: number, repositoryCaseId: number): Promise<TestRunCase | undefined> {
    const cases = await this.getTestRunCases(testRunId);
    return cases.find((c) => c.repositoryCaseId === repositoryCaseId);
  }

  /**
   * Find or add a test case to a run
   */
  async findOrAddTestCaseToRun(options: AddTestCaseToRunOptions): Promise<TestRunCase> {
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
  async createTestResult(options: CreateTestResultOptions): Promise<TestRunResult> {
    return this.request<TestRunResult>('POST', '/api/test-run-results', {
      body: {
        testRunId: options.testRunId,
        testRunCaseId: options.testRunCaseId,
        statusId: options.statusId,
        elapsed: options.elapsed,
        notes: options.notes,
        evidence: options.evidence,
        attempt: options.attempt ?? 1,
      },
    });
  }

  /**
   * Get test results for a test run
   */
  async getTestResults(testRunId: number): Promise<TestRunResult[]> {
    return this.request<TestRunResult[]>('GET', `/api/test-runs/${testRunId}/results`);
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
      formData.append('files', file);
    }

    // Add options
    formData.append('projectId', String(options.projectId));
    if (options.format) formData.append('format', options.format);
    if (options.testRunId) formData.append('testRunId', String(options.testRunId));
    if (options.name) formData.append('name', options.name);
    if (options.configId) formData.append('configId', String(options.configId));
    if (options.milestoneId) formData.append('milestoneId', String(options.milestoneId));
    if (options.stateId) formData.append('stateId', String(options.stateId));
    if (options.parentFolderId) formData.append('parentFolderId', String(options.parentFolderId));
    if (options.templateId) formData.append('templateId', String(options.templateId));
    if (options.tagIds) formData.append('tagIds', JSON.stringify(options.tagIds));

    const url = new URL('/api/test-results/import', this.baseUrl);

    const response = await fetch(url.toString(), {
      method: 'POST',
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
      throw new TestPlanItError('No response body');
    }

    const decoder = new TextDecoder();
    let testRunId: number | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter((line) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6); // Remove 'data: '
        try {
          const event = JSON.parse(data) as ImportProgressEvent;
          onProgress?.(event);

          if (event.complete && event.testRunId) {
            testRunId = event.testRunId;
          }

          if (event.error) {
            throw new TestPlanItError(event.error);
          }
        } catch (e) {
          if (e instanceof TestPlanItError) throw e;
          // Ignore JSON parse errors for partial data
        }
      }
    }

    if (!testRunId) {
      throw new TestPlanItError('Import completed but no test run ID returned');
    }

    return { testRunId };
  }

  // ============================================================================
  // Attachments
  // ============================================================================

  /**
   * Upload an attachment to a test result
   */
  async uploadAttachment(
    testRunResultId: number,
    file: Blob | Buffer,
    fileName: string,
    mimeType?: string
  ): Promise<{ id: number; path: string }> {
    const formData = new FormData();

    if (file instanceof Buffer) {
      formData.append('file', new Blob([file], { type: mimeType }), fileName);
    } else {
      formData.append('file', file, fileName);
    }

    return this.requestFormData('POST', `/api/test-run-results/${testRunResultId}/attachments`, formData);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Test the API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', '/api/health');
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
