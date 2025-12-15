/**
 * TestPlanIt API Types
 * Based on the TestPlanIt OpenAPI schema and Prisma models
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
  aliases?: string | null;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
  isEnabled: boolean;
  isDeleted: boolean;
  colorId: number;
  position: number;
}

/**
 * Project information
 */
export interface Project {
  id: number;
  name: string;
  key: string;
  description?: string | null;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: string;
  createdById: string;
}

/**
 * Configuration (browser/environment combination)
 */
export interface Configuration {
  id: number;
  projectId: number;
  name: string;
  description?: string | null;
  isDeleted: boolean;
}

/**
 * Milestone (release/sprint)
 */
export interface Milestone {
  id: number;
  projectId: number;
  name: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isCompleted: boolean;
  isDeleted: boolean;
  stateId?: number | null;
  createdAt: string;
  createdById: string;
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
  isDeleted: boolean;
  isDefault: boolean;
}

/**
 * Repository folder
 */
export interface RepositoryFolder {
  id: number;
  projectId: number;
  repositoryId: number;
  parentId?: number | null;
  name: string;
  order: number;
  isDeleted: boolean;
}

/**
 * Options for creating a folder
 */
export interface CreateFolderOptions {
  projectId: number;
  name: string;
  parentId?: number;
}

/**
 * Test case template
 */
export interface Template {
  id: number;
  templateName: string;
  isDefault: boolean;
  isEnabled: boolean;
  isDeleted: boolean;
}

/**
 * Tag (global, not project-scoped)
 */
export interface Tag {
  id: number;
  name: string;
  isDeleted: boolean;
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
  note?: Record<string, unknown> | null;
  docs?: Record<string, unknown> | null;
  configId?: number | null;
  milestoneId?: number | null;
  stateId: number;
  forecastManual?: number | null;
  forecastAutomated?: number | null;
  elapsed?: number | null;
  isCompleted: boolean;
  isDeleted: boolean;
  completedAt?: string | null;
  createdAt: string;
  createdById: string;
  testRunType: TestRunType;
  configurationGroupId?: string | null;
  /** Prisma virtual count field */
  _count?: {
    testCases?: number;
    results?: number;
    attachments?: number;
    tags?: number;
    issues?: number;
    junitTestSuites?: number;
    comments?: number;
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
  className?: string | null;
  source: RepositoryCaseSource;
  stateId: number;
  estimate?: number | null;
  forecastManual?: number | null;
  forecastAutomated?: number | null;
  order: number;
  createdAt: string;
  creatorId: string;
  automated: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  currentVersion: number;
  /** @deprecated Use createdAt instead */
  updatedAt?: string;
  /** Prisma virtual count field */
  _count?: {
    repositoryCaseVersions?: number;
    caseFieldValues?: number;
    resultFieldValues?: number;
    attachments?: number;
    steps?: number;
    testRuns?: number;
    tags?: number;
    issues?: number;
    junitResults?: number;
    junitProperties?: number;
  };
}

/**
 * Test case linked to a test run
 */
export interface TestRunCase {
  id: number;
  testRunId: number;
  repositoryCaseId: number;
  order: number;
  statusId?: number | null;
  assignedToId?: string | null;
  isCompleted: boolean;
  notes?: Record<string, unknown> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  elapsed?: number | null;
  createdAt: string;
  /** Prisma virtual count field */
  _count?: {
    results?: number;
  };
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
  editedById?: string | null;
  editedAt?: string | null;
  elapsed?: number | null;
  notes?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  attempt: number;
  isDeleted: boolean;
  /** Prisma virtual count field */
  _count?: {
    attachments?: number;
    resultFieldValues?: number;
    stepResults?: number;
    issues?: number;
  };
}

/**
 * Step-level result within a test
 */
export interface TestRunStepResult {
  id: number;
  testRunResultId: number;
  stepId: number;
  sharedStepItemId?: number | null;
  statusId: number;
  notes?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
  executedAt: string;
  elapsed?: number | null;
  isDeleted: boolean;
  /** Prisma virtual count field */
  _count?: {
    attachments?: number;
    issues?: number;
  };
}

/**
 * File attachment
 */
export interface Attachment {
  id: number;
  name: string;
  url: string;
  size: number;
  mimeType: string;
  note?: string | null;
  createdAt: string;
  createdById: string;
  isDeleted: boolean;
  // Foreign keys (one of these will be set)
  testRunResultsId?: number | null;
  junitTestResultId?: number | null;
  repositoryCaseId?: number | null;
  repositoryCaseVersionId?: number | null;
  testRunId?: number | null;
  stepResultId?: number | null;
  sessionResultId?: number | null;
}

/**
 * User information
 */
export interface User {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  isDeleted: boolean;
}

/**
 * Comment on a test run or other entity
 */
export interface Comment {
  id: number;
  content: Record<string, unknown>;
  createdAt: string;
  createdById: string;
  updatedAt?: string | null;
  isDeleted: boolean;
  // Foreign keys
  testRunId?: number | null;
  repositoryCaseId?: number | null;
  sessionId?: number | null;
}

/**
 * Issue/defect linked to test results
 */
export interface Issue {
  id: number;
  name: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  externalId?: string | null;
  externalKey?: string | null;
  externalUrl?: string | null;
  createdAt: string;
  createdById: string;
  isDeleted: boolean;
}

// ============================================================================
// JUnit Models
// ============================================================================

/**
 * JUnit result type enum
 */
export type JUnitResultType = 'PASSED' | 'FAILURE' | 'ERROR' | 'SKIPPED';

/**
 * JUnit test suite (for automated test results)
 */
export interface JUnitTestSuite {
  id: number;
  testRunId: number;
  parentId?: number | null;
  name: string;
  time?: number | null;
  tests?: number | null;
  failures?: number | null;
  errors?: number | null;
  skipped?: number | null;
  assertions?: number | null;
  timestamp?: string | null;
  file?: string | null;
  hostname?: string | null;
  systemOut?: string | null;
  systemErr?: string | null;
  createdAt: string;
  createdById: string;
  /** Prisma virtual count field */
  _count?: {
    children?: number;
    testResults?: number;
    properties?: number;
  };
}

/**
 * JUnit test result (for automated test results)
 */
export interface JUnitTestResult {
  id: number;
  testSuiteId: number;
  repositoryCaseId: number;
  type: JUnitResultType;
  message?: string | null;
  content?: string | null;
  statusId?: number | null;
  executedAt?: string | null;
  time?: number | null;
  assertions?: number | null;
  file?: string | null;
  line?: number | null;
  systemOut?: string | null;
  systemErr?: string | null;
  createdAt: string;
  createdById: string;
  /** Prisma virtual count field */
  _count?: {
    attachments?: number;
    steps?: number;
    properties?: number;
  };
}

/**
 * JUnit property (key-value metadata)
 */
export interface JUnitProperty {
  id: number;
  name: string;
  value?: string | null;
  testSuiteId?: number | null;
  testResultId?: number | null;
  repositoryCaseId?: number | null;
}

/**
 * JUnit test step (for detailed test execution)
 */
export interface JUnitTestStep {
  id: number;
  testResultId: number;
  order: number;
  name?: string | null;
  status: JUnitResultType;
  duration?: number | null;
  message?: string | null;
  stackTrace?: string | null;
  screenshot?: string | null;
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
  tagIds?: number[];
  note?: Record<string, unknown>;
  docs?: Record<string, unknown>;
}

/**
 * Options for updating a test run
 */
export interface UpdateTestRunOptions {
  name?: string;
  isCompleted?: boolean;
  completedAt?: Date | string | null;
  configId?: number | null;
  milestoneId?: number | null;
  stateId?: number;
  note?: Record<string, unknown> | null;
  docs?: Record<string, unknown> | null;
  /** ZenStack relation syntax for updating the workflow state */
  state?: { connect: { id: number } };
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
 * Result of findOrCreateTestCase with metadata
 */
export interface FindOrCreateTestCaseResult {
  testCase: RepositoryCase;
  /** How the test case was resolved */
  action: 'found' | 'created' | 'moved';
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
  isDeleted?: boolean;
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
  folderId?: number;
  isDeleted?: boolean;
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

/**
 * Options for creating a JUnit test suite
 */
export interface CreateJUnitTestSuiteOptions {
  testRunId: number;
  name: string;
  time?: number;
  tests?: number;
  failures?: number;
  errors?: number;
  skipped?: number;
  assertions?: number;
  timestamp?: Date;
  file?: string;
  hostname?: string;
  systemOut?: string;
  systemErr?: string;
  parentId?: number;
}

/**
 * Options for creating a JUnit test result
 */
export interface CreateJUnitTestResultOptions {
  testSuiteId: number;
  repositoryCaseId: number;
  type: JUnitResultType;
  message?: string;
  content?: string;
  statusId?: number;
  executedAt?: Date;
  time?: number;
  assertions?: number;
  file?: string;
  line?: number;
  systemOut?: string;
  systemErr?: string;
}

/**
 * Options for updating a JUnit test suite
 */
export interface UpdateJUnitTestSuiteOptions {
  name?: string;
  time?: number;
  tests?: number;
  failures?: number;
  errors?: number;
  skipped?: number;
  assertions?: number;
  systemOut?: string;
  systemErr?: string;
}

/**
 * Options for creating a JUnit property
 */
export interface CreateJUnitPropertyOptions {
  name: string;
  value?: string;
  testSuiteId?: number;
  testResultId?: number;
  repositoryCaseId?: number;
}

/**
 * Options for creating a JUnit test step
 */
export interface CreateJUnitTestStepOptions {
  testResultId: number;
  order: number;
  name?: string;
  status: JUnitResultType;
  duration?: number;
  message?: string;
  stackTrace?: string;
  screenshot?: string;
}
