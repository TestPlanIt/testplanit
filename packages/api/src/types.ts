/**
 * TestPlanIt API Types
 * Based on the TestPlanIt schema.zmodel
 */

// ============================================================================
// Enums
// ============================================================================

export type TestRunType =
  | 'REGULAR'
  | 'JUNIT'
  | 'TESTNG'
  | 'XUNIT'
  | 'NUNIT'
  | 'MSTEST'
  | 'MOCHA'
  | 'CUCUMBER';

export type RepositoryCaseSource =
  | 'MANUAL'
  | 'JUNIT'
  | 'TESTNG'
  | 'XUNIT'
  | 'NUNIT'
  | 'MSTEST'
  | 'MOCHA'
  | 'CUCUMBER'
  | 'API';

// ============================================================================
// Core Models
// ============================================================================

/**
 * Test status definition
 */
export interface Status {
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
export interface Project {
  id: number;
  name: string;
  key: string;
  description?: string;
  isArchived: boolean;
}

/**
 * Configuration (browser/environment combination)
 */
export interface Configuration {
  id: number;
  projectId: number;
  name: string;
  description?: string;
}

/**
 * Milestone (release/sprint)
 */
export interface Milestone {
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
export interface WorkflowState {
  id: number;
  projectId: number;
  name: string;
  colorId: number;
  position: number;
}

/**
 * Repository folder
 */
export interface RepositoryFolder {
  id: number;
  projectId: number;
  repositoryId: number;
  parentId?: number;
  name: string;
}

/**
 * Test case template
 */
export interface Template {
  id: number;
  projectId: number;
  name: string;
  description?: string;
  isDefault: boolean;
}

/**
 * Tag (global, not project-scoped)
 */
export interface Tag {
  id: number;
  name: string;
  isDeleted?: boolean;
}

/**
 * Options for creating a tag
 */
export interface CreateTagOptions {
  name: string;
}

/**
 * Test run (execution session)
 */
export interface TestRun {
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
export interface RepositoryCase {
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
export interface TestRunCase {
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
export interface TestRunResult {
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
export interface TestRunStepResult {
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
export interface Attachment {
  id: number;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Options for creating a test run
 */
export interface CreateTestRunOptions {
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
export interface UpdateTestRunOptions {
  name?: string;
  isCompleted?: boolean;
  configId?: number;
  milestoneId?: number;
  stateId?: number;
}

/**
 * Options for creating a test case
 */
export interface CreateTestCaseOptions {
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
export interface AddTestCaseToRunOptions {
  testRunId: number;
  repositoryCaseId: number;
  assignedToId?: string;
}

/**
 * Options for creating a test result
 */
export interface CreateTestResultOptions {
  testRunId: number;
  testRunCaseId: number;
  statusId: number;
  elapsed?: number;
  notes?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  attempt?: number;
}

/**
 * Options for uploading attachments
 */
export interface UploadAttachmentOptions {
  testRunResultId: number;
  file: Blob | Buffer;
  fileName: string;
  mimeType?: string;
}

/**
 * Test results import options
 */
export interface ImportTestResultsOptions {
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
export interface ImportProgressEvent {
  progress: number;
  status: string;
  complete?: boolean;
  testRunId?: number;
  error?: string;
}

/**
 * Query options for listing test runs
 */
export interface ListTestRunsOptions {
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
export interface PaginatedResponse<T> {
  data: T[];
  totalCount: number;
  pageCount: number;
  page: number;
  pageSize: number;
}

/**
 * Query options for finding test cases
 */
export interface FindTestCaseOptions {
  projectId: number;
  name?: string;
  className?: string;
  source?: RepositoryCaseSource;
}

/**
 * API client configuration
 */
export interface TestPlanItClientConfig {
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
export interface ApiError {
  message: string;
  statusCode?: number;
  code?: string;
  details?: unknown;
}

/**
 * Normalized test status for mapping
 */
export type NormalizedStatus = 'passed' | 'failed' | 'skipped' | 'blocked' | 'pending';
