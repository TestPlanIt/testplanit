import type { Reporters } from '@wdio/types';

/**
 * Configuration options for the TestPlanIt WebdriverIO reporter
 */
export interface TestPlanItReporterOptions extends Reporters.Options {
  /**
   * The base URL of your TestPlanIt instance
   * @example 'https://testplanit.example.com'
   */
  domain: string;

  /**
   * API token for authentication
   * Generate this from TestPlanIt: Settings > API Tokens
   * Should start with 'tpi_'
   */
  apiToken: string;

  /**
   * The project ID in TestPlanIt where results will be reported
   */
  projectId: number;

  /**
   * Existing test run to add results to (ID or name).
   * If a string is provided, the system will look up the test run by exact name match.
   * If not provided, a new test run will be created.
   */
  testRunId?: number | string;

  /**
   * Name for the new test run (required if testRunId is not provided)
   * Supports placeholders:
   * - {date} - Current date (YYYY-MM-DD)
   * - {time} - Current time (HH:MM:SS)
   * - {browser} - Browser name from capabilities
   * - {platform} - Platform/OS name
   * - {spec} - Spec file name (without .spec.ts extension)
   * - {suite} - Root suite name (first describe block)
   * @default '{suite} - {date} {time}'
   */
  runName?: string;

  /**
   * Test run type to indicate the test framework being used.
   * Auto-detected from WebdriverIO config:
   * - 'mocha' framework → 'MOCHA'
   * - 'cucumber' framework → 'CUCUMBER'
   * - others → 'REGULAR'
   * Override this if you need a specific type.
   */
  testRunType?: 'REGULAR' | 'JUNIT' | 'TESTNG' | 'XUNIT' | 'NUNIT' | 'MSTEST' | 'MOCHA' | 'CUCUMBER';

  /**
   * Configuration to associate with the test run (ID or name).
   * If a string is provided, the system will look up the configuration by exact name match.
   */
  configId?: number | string;

  /**
   * Milestone to associate with the test run (ID or name).
   * If a string is provided, the system will look up the milestone by exact name match.
   */
  milestoneId?: number | string;

  /**
   * Workflow state for the test run (ID or name).
   * If a string is provided, the system will look up the state by exact name match.
   */
  stateId?: number | string;

  /**
   * Parent folder for auto-created test cases (ID or name).
   * If a string is provided, the system will look up the folder by exact name match.
   */
  parentFolderId?: number | string;

  /**
   * Template for auto-created test cases (ID or name).
   * If a string is provided, the system will look up the template by exact name match.
   */
  templateId?: number | string;

  /**
   * Tags to apply to the test run (IDs or names).
   * If strings are provided, the system will look up each tag by exact name match.
   * Tags that don't exist will be created automatically.
   */
  tagIds?: (number | string)[];

  /**
   * Regular expression pattern to extract test case IDs from test titles.
   * The pattern MUST include a capturing group that captures the numeric case ID.
   *
   * @default /\[(\d+)\]/g - Matches IDs in brackets like "[1761]"
   *
   * @example
   * // Default pattern - brackets: "[1761] should load the page"
   * caseIdPattern: /\[(\d+)\]/g
   *
   * @example
   * // C-prefix pattern: "C12345 should load the page"
   * caseIdPattern: /C(\d+)/g
   *
   * @example
   * // TC- prefix pattern: "TC-12345 should load the page"
   * caseIdPattern: /TC-(\d+)/g
   *
   * @example
   * // JIRA-style pattern: "TEST-12345 should load the page"
   * caseIdPattern: /TEST-(\d+)/g
   *
   * @example
   * // Multiple formats: matches both "[1234]" and "C1234"
   * caseIdPattern: /(?:\[(\d+)\]|C(\d+))/g
   */
  caseIdPattern?: RegExp | string;

  /**
   * Whether to automatically create test cases in TestPlanIt if they don't exist
   * Test cases are matched by className (suite name) + name (test title)
   * @default false
   */
  autoCreateTestCases?: boolean;

  /**
   * Whether to create folder hierarchy based on Mocha suite structure
   * When enabled, nested describe blocks create nested folders:
   * describe('Suite A') > describe('Suite B') > it('test')
   * Creates folders: parentFolderId > Suite A > Suite B
   * The test case is placed in the innermost folder
   * Requires autoCreateTestCases and parentFolderId to be set
   * @default false
   */
  createFolderHierarchy?: boolean;

  /**
   * Whether to upload screenshots to TestPlanIt.
   * Note: The reporter intercepts screenshots taken via browser.takeScreenshot() or
   * browser.saveScreenshot(). You must configure an afterTest hook to capture screenshots
   * on failure - the reporter does not automatically take screenshots.
   * @default true
   */
  uploadScreenshots?: boolean;

  /**
   * Whether to include test error stack traces in results
   * @default true
   */
  includeStackTrace?: boolean;

  /**
   * Whether to mark the test run as completed when all tests finish
   * @default true
   */
  completeRunOnFinish?: boolean;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Number of retries for failed API requests
   * @default 3
   */
  maxRetries?: number;

  /**
   * Enable verbose logging for debugging
   * @default false
   */
  verbose?: boolean;

  /**
   * Consolidate all results into a single test run across all workers/spec files.
   * When true, uses a shared state file to coordinate between WebdriverIO workers,
   * ensuring all results are reported to the same test run.
   *
   * Note: When oneReport is true, the test run will NOT be automatically completed
   * (even if completeRunOnFinish is true) since we can't determine which worker
   * finishes last. The shared state file expires after 4 hours.
   *
   * @default true
   */
  oneReport?: boolean;
}

/**
 * Internal test result tracked by the reporter
 */
export interface TrackedTestResult {
  /** Test case ID from TestPlanIt (parsed from title) */
  caseId?: number;
  /** Repository case ID (looked up or created) */
  repositoryCaseId?: number;
  /** Test run case ID */
  testRunCaseId?: number;
  /** Suite/class name (joined path) */
  suiteName: string;
  /** Suite path as array (for folder hierarchy) */
  suitePath: string[];
  /** Test title/name (without case ID prefix) */
  testName: string;
  /** Full test title including parent suites */
  fullTitle: string;
  /** Original test title (with case ID if present) */
  originalTitle: string;
  /** Test status */
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  /** Test duration in milliseconds */
  duration: number;
  /** Error message if test failed */
  errorMessage?: string;
  /** Error stack trace if test failed */
  stackTrace?: string;
  /** Timestamp when test started */
  startedAt: Date;
  /** Timestamp when test finished */
  finishedAt: Date;
  /** Browser name */
  browser?: string;
  /** Platform/OS name */
  platform?: string;
  /** Screenshot paths for failed tests */
  screenshots: string[];
  /** Retry attempt number (0-based) */
  retryAttempt: number;
  /** Unique identifier for this test (cid + fullTitle) */
  uid: string;
  /** Spec file path */
  specFile?: string;
  /** WebdriverIO command output logs */
  commandOutput?: string;
  /** JUnit test result ID (set after result is created, used for deferred screenshot upload) */
  junitResultId?: number;
}

/**
 * Resolved IDs after looking up names
 */
export interface ResolvedIds {
  testRunId?: number;
  configId?: number;
  milestoneId?: number;
  stateId?: number;
  parentFolderId?: number;
  templateId?: number;
  tagIds?: number[];
}

/**
 * JUnit test suite statistics tracked during test execution
 */
export interface JUnitSuiteStats {
  /** Total tests in suite */
  tests: number;
  /** Failed tests */
  failures: number;
  /** Errored tests */
  errors: number;
  /** Skipped tests */
  skipped: number;
  /** Total execution time in milliseconds */
  time: number;
}

/**
 * Statistics tracked during the test run for the final summary
 */
export interface ReporterStats {
  /** Number of test cases that matched existing cases in TestPlanIt */
  testCasesFound: number;
  /** Number of test cases that were newly created in TestPlanIt */
  testCasesCreated: number;
  /** Number of test cases that were moved from deleted folders */
  testCasesMoved: number;
  /** Number of folders that were created for hierarchy */
  foldersCreated: number;
  /** Number of test results reported (passed) */
  resultsPassed: number;
  /** Number of test results reported (failed) */
  resultsFailed: number;
  /** Number of test results reported (skipped) */
  resultsSkipped: number;
  /** Number of screenshots uploaded */
  screenshotsUploaded: number;
  /** Number of screenshot upload failures */
  screenshotsFailed: number;
  /** Number of API errors encountered */
  apiErrors: number;
  /** Total API requests made */
  apiRequests: number;
  /** Start time of the test run */
  startTime: Date;
}

/**
 * Reporter state
 */
export interface ReporterState {
  /** Created test run ID */
  testRunId?: number;
  /** Created JUnit test suite ID (for automated test types) */
  testSuiteId?: number;
  /** JUnit test suite statistics */
  testSuiteStats: JUnitSuiteStats;
  /** Resolved numeric IDs from name lookups */
  resolvedIds: ResolvedIds;
  /** Map of test UID to tracked result */
  results: Map<string, TrackedTestResult>;
  /** Map of repository case keys to IDs */
  caseIdMap: Map<string, number>;
  /** Map of test run case keys to IDs */
  testRunCaseMap: Map<string, number>;
  /** Map of folder paths (joined by >) to folder IDs for caching */
  folderPathMap: Map<string, number>;
  /** Status ID mappings */
  statusIds: {
    passed?: number;
    failed?: number;
    skipped?: number;
    blocked?: number;
    pending?: number;
  };
  /** Whether initialization is complete */
  initialized: boolean;
  /** Initialization error if any */
  initError?: Error;
  /** Current browser capabilities */
  capabilities?: WebdriverIO.Capabilities;
  /** Statistics for the final summary */
  stats: ReporterStats;
}
