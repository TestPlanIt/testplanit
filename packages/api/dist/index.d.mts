/**
 * TestPlanIt API Types
 * Based on the TestPlanIt schema.zmodel
 */
type TestRunType = 'REGULAR' | 'JUNIT' | 'TESTNG' | 'XUNIT' | 'NUNIT' | 'MSTEST' | 'MOCHA' | 'CUCUMBER';
type RepositoryCaseSource = 'MANUAL' | 'JUNIT' | 'TESTNG' | 'XUNIT' | 'NUNIT' | 'MSTEST' | 'MOCHA' | 'CUCUMBER' | 'API';
/**
 * Test status definition
 */
interface Status {
    id: number;
    name: string;
    systemName: string;
    aliases?: string;
    isSuccess: boolean;
    isFailure: boolean;
    isCompleted: boolean;
    isEnabled: boolean;
    colorId: number;
}
/**
 * Project information
 */
interface Project {
    id: number;
    name: string;
    key: string;
    description?: string;
    isArchived: boolean;
}
/**
 * Configuration (browser/environment combination)
 */
interface Configuration {
    id: number;
    projectId: number;
    name: string;
    description?: string;
}
/**
 * Milestone (release/sprint)
 */
interface Milestone {
    id: number;
    projectId: number;
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    isCompleted: boolean;
}
/**
 * Workflow state
 */
interface WorkflowState {
    id: number;
    projectId: number;
    name: string;
    colorId: number;
    position: number;
}
/**
 * Repository folder
 */
interface RepositoryFolder {
    id: number;
    projectId: number;
    repositoryId: number;
    parentId?: number;
    name: string;
}
/**
 * Test case template
 */
interface Template {
    id: number;
    projectId: number;
    name: string;
    description?: string;
    isDefault: boolean;
}
/**
 * Tag (global, not project-scoped)
 */
interface Tag {
    id: number;
    name: string;
    isDeleted?: boolean;
}
/**
 * Options for creating a tag
 */
interface CreateTagOptions {
    name: string;
}
/**
 * Test run (execution session)
 */
interface TestRun {
    id: number;
    projectId: number;
    name: string;
    testRunType: TestRunType;
    isCompleted: boolean;
    completedAt?: string;
    createdById: string;
    createdAt: string;
    configId?: number;
    milestoneId?: number;
    stateId: number;
    elapsed?: number;
    _count?: {
        testCases: number;
        results: number;
    };
}
/**
 * Test case in repository
 */
interface RepositoryCase {
    id: number;
    projectId: number;
    repositoryId: number;
    folderId: number;
    templateId: number;
    name: string;
    className?: string;
    source: RepositoryCaseSource;
    automated: boolean;
    stateId: number;
    estimate?: number;
    currentVersion: number;
    createdAt: string;
    updatedAt: string;
}
/**
 * Test case linked to a test run
 */
interface TestRunCase {
    id: number;
    testRunId: number;
    repositoryCaseId: number;
    statusId?: number;
    isCompleted: boolean;
    completedAt?: string;
    startedAt?: string;
    elapsed?: number;
    assignedToId?: string;
    notes?: Record<string, unknown>;
}
/**
 * Individual test result
 */
interface TestRunResult {
    id: number;
    testRunId: number;
    testRunCaseId: number;
    testRunCaseVersion: number;
    statusId: number;
    executedById: string;
    executedAt: string;
    editedById?: string;
    editedAt?: string;
    elapsed?: number;
    notes?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    attempt: number;
}
/**
 * Step-level result within a test
 */
interface TestRunStepResult {
    id: number;
    testRunResultId: number;
    stepId: number;
    sharedStepItemId?: number;
    statusId: number;
    notes?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    executedAt: string;
    elapsed?: number;
}
/**
 * File attachment
 */
interface Attachment {
    id: number;
    name: string;
    path: string;
    size: number;
    mimeType: string;
    createdAt: string;
}
/**
 * Options for creating a test run
 */
interface CreateTestRunOptions {
    projectId: number;
    name: string;
    testRunType?: TestRunType;
    configId?: number;
    milestoneId?: number;
    stateId?: number;
}
/**
 * Options for updating a test run
 */
interface UpdateTestRunOptions {
    name?: string;
    isCompleted?: boolean;
    configId?: number;
    milestoneId?: number;
    stateId?: number;
}
/**
 * Options for creating a test case
 */
interface CreateTestCaseOptions {
    projectId: number;
    folderId: number;
    templateId: number;
    name: string;
    className?: string;
    source?: RepositoryCaseSource;
    automated?: boolean;
    stateId?: number;
    estimate?: number;
}
/**
 * Options for adding a test case to a run
 */
interface AddTestCaseToRunOptions {
    testRunId: number;
    repositoryCaseId: number;
    assignedToId?: string;
}
/**
 * Options for creating a test result
 */
interface CreateTestResultOptions {
    testRunId: number;
    testRunCaseId: number;
    statusId: number;
    elapsed?: number;
    notes?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    attempt?: number;
}
/**
 * Test results import options
 */
interface ImportTestResultsOptions {
    projectId: number;
    files: File[] | Blob[];
    format?: 'auto' | 'junit' | 'testng' | 'xunit' | 'nunit' | 'mstest' | 'mocha' | 'cucumber';
    testRunId?: number;
    name?: string;
    configId?: number;
    milestoneId?: number;
    stateId?: number;
    parentFolderId?: number;
    templateId?: number;
    tagIds?: number[];
}
/**
 * Import progress event
 */
interface ImportProgressEvent {
    progress: number;
    status: string;
    complete?: boolean;
    testRunId?: number;
    error?: string;
}
/**
 * Query options for listing test runs
 */
interface ListTestRunsOptions {
    projectId: number;
    page?: number;
    pageSize?: number;
    search?: string;
    runType?: 'both' | 'manual' | 'automated';
    isCompleted?: boolean;
}
/**
 * Paginated response
 */
interface PaginatedResponse<T> {
    data: T[];
    totalCount: number;
    pageCount: number;
    page: number;
    pageSize: number;
}
/**
 * Query options for finding test cases
 */
interface FindTestCaseOptions {
    projectId: number;
    name?: string;
    className?: string;
    source?: RepositoryCaseSource;
}
/**
 * API client configuration
 */
interface TestPlanItClientConfig {
    /**
     * Base URL of your TestPlanIt instance
     * @example 'https://testplanit.example.com'
     */
    baseUrl: string;
    /**
     * API token for authentication (starts with 'tpi_')
     */
    apiToken: string;
    /**
     * Request timeout in milliseconds
     * @default 30000
     */
    timeout?: number;
    /**
     * Number of retries for failed requests
     * @default 3
     */
    maxRetries?: number;
    /**
     * Delay between retries in milliseconds
     * @default 1000
     */
    retryDelay?: number;
    /**
     * Custom headers to include in all requests
     */
    headers?: Record<string, string>;
}
/**
 * API error
 */
interface ApiError {
    message: string;
    statusCode?: number;
    code?: string;
    details?: unknown;
}
/**
 * Normalized test status for mapping
 */
type NormalizedStatus = 'passed' | 'failed' | 'skipped' | 'blocked' | 'pending';

/**
 * Custom error class for TestPlanIt API errors
 */
declare class TestPlanItError extends Error {
    statusCode?: number;
    code?: string;
    details?: unknown;
    constructor(message: string, options?: Partial<ApiError>);
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
declare class TestPlanItClient {
    private readonly baseUrl;
    private readonly apiToken;
    private readonly timeout;
    private readonly maxRetries;
    private readonly retryDelay;
    private readonly headers;
    private statusCache;
    constructor(config: TestPlanItClientConfig);
    /**
     * Make an authenticated request to the API
     */
    private request;
    /**
     * Make a multipart form data request
     */
    private requestFormData;
    private sleep;
    /**
     * Get project by ID
     */
    getProject(projectId: number): Promise<Project>;
    /**
     * List all projects accessible to the authenticated user
     */
    listProjects(): Promise<Project[]>;
    /**
     * Get all statuses for a project
     */
    getStatuses(projectId: number): Promise<Status[]>;
    /**
     * Get status ID for a normalized status name
     */
    getStatusId(projectId: number, status: NormalizedStatus): Promise<number | undefined>;
    /**
     * Clear the status cache (useful if statuses are updated)
     */
    clearStatusCache(): void;
    /**
     * Create a new test run
     */
    createTestRun(options: CreateTestRunOptions): Promise<TestRun>;
    /**
     * Get a test run by ID
     */
    getTestRun(testRunId: number): Promise<TestRun>;
    /**
     * Update a test run
     */
    updateTestRun(testRunId: number, options: UpdateTestRunOptions): Promise<TestRun>;
    /**
     * Complete a test run
     */
    completeTestRun(testRunId: number): Promise<TestRun>;
    /**
     * List test runs for a project
     */
    listTestRuns(options: ListTestRunsOptions): Promise<PaginatedResponse<TestRun>>;
    /**
     * Find a test run by name (exact match)
     */
    findTestRunByName(projectId: number, name: string): Promise<TestRun | undefined>;
    /**
     * List all configurations for a project
     */
    listConfigurations(projectId: number): Promise<Configuration[]>;
    /**
     * Find a configuration by name (exact match)
     */
    findConfigurationByName(projectId: number, name: string): Promise<Configuration | undefined>;
    /**
     * List all milestones for a project
     */
    listMilestones(projectId: number): Promise<Milestone[]>;
    /**
     * Find a milestone by name (exact match)
     */
    findMilestoneByName(projectId: number, name: string): Promise<Milestone | undefined>;
    /**
     * List all workflow states for a project
     */
    listWorkflowStates(projectId: number): Promise<WorkflowState[]>;
    /**
     * Find a workflow state by name (exact match)
     */
    findWorkflowStateByName(projectId: number, name: string): Promise<WorkflowState | undefined>;
    /**
     * List all folders for a project
     */
    listFolders(projectId: number): Promise<RepositoryFolder[]>;
    /**
     * Find a folder by name (exact match)
     */
    findFolderByName(projectId: number, name: string): Promise<RepositoryFolder | undefined>;
    /**
     * List all templates for a project
     */
    listTemplates(projectId: number): Promise<Template[]>;
    /**
     * Find a template by name (exact match)
     */
    findTemplateByName(projectId: number, name: string): Promise<Template | undefined>;
    /**
     * List all tags for a project
     */
    listTags(projectId: number): Promise<Tag[]>;
    /**
     * Create a new tag
     * Tags are global (not project-scoped) and can be used across all projects
     */
    createTag(options: CreateTagOptions): Promise<Tag>;
    /**
     * Find a tag by name (exact match)
     */
    findTagByName(projectId: number, name: string): Promise<Tag | undefined>;
    /**
     * Find or create a tag by name
     * Tags are global (not project-scoped)
     */
    findOrCreateTag(projectId: number, name: string): Promise<Tag>;
    /**
     * Resolve multiple tag IDs or names to numeric IDs
     * If a tag name doesn't exist, it will be created automatically
     */
    resolveTagIds(projectId: number, tagIdsOrNames: (number | string)[]): Promise<number[]>;
    /**
     * Create a new test case in the repository
     */
    createTestCase(options: CreateTestCaseOptions): Promise<RepositoryCase>;
    /**
     * Get a test case by ID
     */
    getTestCase(caseId: number): Promise<RepositoryCase>;
    /**
     * Find test cases matching criteria
     */
    findTestCases(options: FindTestCaseOptions): Promise<RepositoryCase[]>;
    /**
     * Find or create a test case
     * Searches for an existing case by name/className, creates if not found
     */
    findOrCreateTestCase(options: CreateTestCaseOptions): Promise<RepositoryCase>;
    /**
     * Add a test case to a test run
     */
    addTestCaseToRun(options: AddTestCaseToRunOptions): Promise<TestRunCase>;
    /**
     * Get test run cases for a test run
     */
    getTestRunCases(testRunId: number): Promise<TestRunCase[]>;
    /**
     * Find a test run case by repository case ID
     */
    findTestRunCase(testRunId: number, repositoryCaseId: number): Promise<TestRunCase | undefined>;
    /**
     * Find or add a test case to a run
     */
    findOrAddTestCaseToRun(options: AddTestCaseToRunOptions): Promise<TestRunCase>;
    /**
     * Create a test result
     */
    createTestResult(options: CreateTestResultOptions): Promise<TestRunResult>;
    /**
     * Get test results for a test run
     */
    getTestResults(testRunId: number): Promise<TestRunResult[]>;
    /**
     * Import test results from files (JUnit, TestNG, etc.)
     * Returns a stream of progress events
     */
    importTestResults(options: ImportTestResultsOptions, onProgress?: (event: ImportProgressEvent) => void): Promise<{
        testRunId: number;
    }>;
    /**
     * Upload an attachment to a test result
     */
    uploadAttachment(testRunResultId: number, file: Blob | Buffer, fileName: string, mimeType?: string): Promise<{
        id: number;
        path: string;
    }>;
    /**
     * Test the API connection
     */
    testConnection(): Promise<boolean>;
    /**
     * Get the base URL
     */
    getBaseUrl(): string;
}

export { type AddTestCaseToRunOptions, type ApiError, type Attachment, type Configuration, type CreateTagOptions, type CreateTestCaseOptions, type CreateTestResultOptions, type CreateTestRunOptions, type FindTestCaseOptions, type ImportProgressEvent, type ImportTestResultsOptions, type ListTestRunsOptions, type Milestone, type NormalizedStatus, type PaginatedResponse, type Project, type RepositoryCase, type RepositoryCaseSource, type RepositoryFolder, type Status, type Tag, type Template, TestPlanItClient, type TestPlanItClientConfig, TestPlanItError, type TestRun, type TestRunCase, type TestRunResult, type TestRunStepResult, type TestRunType, type UpdateTestRunOptions, type WorkflowState };
