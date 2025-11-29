/**
 * Types for report drill-down functionality
 * These types define the structure for drilling into report metrics to see underlying records
 */

/**
 * Dimension value that can be used for filtering drill-down queries
 */
export interface DimensionValue {
  id: string | number;
  name?: string;
  label?: string;
  executedAt?: string; // For date dimensions
  [key: string]: unknown;
}

/**
 * Map of dimension IDs to their values
 */
export interface DimensionFilters {
  user?: DimensionValue;
  status?: DimensionValue;
  testRun?: DimensionValue;
  testCase?: DimensionValue;
  milestone?: DimensionValue;
  configuration?: DimensionValue;
  project?: DimensionValue;
  date?: DimensionValue;
  [key: string]: DimensionValue | undefined;
}

/**
 * Context captured when a user clicks a metric value
 */
export interface DrillDownContext {
  /** The metric that was clicked (e.g., 'testResults', 'testRuns') */
  metricId: string;
  /** The label of the metric for display */
  metricLabel: string;
  /** The numeric value that was clicked */
  metricValue: number;
  /** The type of report (e.g., 'test-execution', 'user-engagement') */
  reportType: string;
  /** Whether this is a project-specific or cross-project report */
  mode: "project" | "cross-project";
  /** Project ID for project-specific reports */
  projectId?: number;
  /** Dimension filters extracted from the clicked row */
  dimensions: DimensionFilters;
  /** Date range filters applied to the report */
  startDate?: string;
  endDate?: string;
}

/**
 * Request to fetch drill-down records
 */
export interface DrillDownRequest {
  context: DrillDownContext;
  /** Offset for pagination */
  offset: number;
  /** Number of records to fetch */
  limit: number;
}

/**
 * Base type for drill-down records
 * Extends the DataRow interface requirements from DataTable
 */
export interface BaseDrillDownRecord {
  id: number | string;
  name: string;
  [key: string]: unknown;
}

/**
 * Test execution drill-down record
 */
export interface TestExecutionRecord extends BaseDrillDownRecord {
  id: number;
  name: string; // The test case name for display
  testRunCaseId: number;
  testRunCase: {
    id: number;
    repositoryCase: {
      id: number;
      name: string;
    };
  };
  testRunId: number;
  testRun: {
    id: number;
    name: string;
    configId?: number | null;
    configuration?: {
      id: number;
      name: string;
    } | null;
  };
  statusId: number;
  status: {
    id: number;
    name: string;
    color: { value: string };
  };
  executedById: string;
  executedBy: {
    id: string;
    name: string;
    email: string;
  };
  executedAt: string;
  elapsed?: number;
  notes?: any | null;
}

/**
 * Test run drill-down record
 */
export interface TestRunRecord extends BaseDrillDownRecord {
  id: number;
  name: string;
  projectId: number;
  project: {
    id: number;
    name: string;
  };
  statusId: number;
  status: {
    id: number;
    name: string;
    color: { value: string };
  };
  createdById: string;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  passed?: number;
  failed?: number;
  blocked?: number;
  untested?: number;
}

/**
 * Test case drill-down record
 */
export interface TestCaseRecord extends BaseDrillDownRecord {
  id: number;
  name: string;
  projectId: number;
  project: {
    id: number;
    name: string;
  };
  folderId?: number | null;
  folder?: {
    id: number;
    name: string;
  } | null;
  priority?: string;
  statusId?: number;
  status?: {
    id: number;
    name: string;
    color: { value: string };
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Exploratory session drill-down record
 */
export interface SessionRecord extends BaseDrillDownRecord {
  id: number;
  name: string;
  charter?: string | null;
  projectId: number;
  project: {
    id: number;
    name: string;
  };
  createdById: string;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  duration?: number;
}

/**
 * Issue drill-down record
 */
export interface IssueRecord extends BaseDrillDownRecord {
  id: number;
  name: string; // Issue name
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  externalKey?: string;
  projectId: number;
  project: {
    id: number;
    name: string;
  };
  createdById: string;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
}

/**
 * Union type of all possible drill-down record types
 */
export type DrillDownRecord =
  | TestExecutionRecord
  | TestRunRecord
  | TestCaseRecord
  | SessionRecord
  | IssueRecord;

/**
 * Response from drill-down API
 */
export interface DrillDownResponse {
  /** The records fetched */
  data: DrillDownRecord[];
  /** Total number of records matching the filters */
  total: number;
  /** Whether there are more records to fetch */
  hasMore: boolean;
  /** The context used for this query */
  context: DrillDownContext;
  /** Optional aggregate statistics (e.g., status counts for pass rate) */
  aggregates?: {
    statusCounts?: Array<{
      statusId: number;
      statusName: string;
      statusColor?: string;
      count: number;
    }>;
    passRate?: number;
  };
}

/**
 * Type guard to check if a record is a test execution record
 */
export function isTestExecutionRecord(
  record: DrillDownRecord
): record is TestExecutionRecord {
  return "testCaseId" in record && "testRunId" in record && "executedAt" in record;
}

/**
 * Type guard to check if a record is a test run record
 */
export function isTestRunRecord(record: DrillDownRecord): record is TestRunRecord {
  return "startedAt" in record && "passed" in record;
}

/**
 * Type guard to check if a record is a test case record
 */
export function isTestCaseRecord(record: DrillDownRecord): record is TestCaseRecord {
  return "folderId" in record && "priority" in record;
}

/**
 * Type guard to check if a record is a session record
 */
export function isSessionRecord(record: DrillDownRecord): record is SessionRecord {
  return "charter" in record && "duration" in record;
}

/**
 * Type guard to check if a record is an issue record
 */
export function isIssueRecord(record: DrillDownRecord): record is IssueRecord {
  return "key" in record && "summary" in record;
}
