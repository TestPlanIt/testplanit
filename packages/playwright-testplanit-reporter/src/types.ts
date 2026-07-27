import type { RunMetadata } from '@testplanit/api';

/**
 * A link attached at the test-run level (e.g. a CI build URL).
 * All string values support `{env:VAR}` placeholders when used in
 * {@link TestPlanItReporterOptions.runLinks}.
 */
export interface RunLinkInput {
  /** External URL the link points at. */
  url: string;
  /** Display name shown on the run detail page. Defaults to the URL. */
  name?: string;
  /** Optional note shown with the attachment. */
  note?: string;
}

/**
 * A file attached at the test-run level. Provide either `path` (read from
 * disk) or `buffer` (in-memory content). String values support `{env:VAR}`
 * placeholders when used in {@link TestPlanItReporterOptions.runAttachments}.
 */
export interface RunAttachmentInput {
  /** Path to a file on disk. */
  path?: string;
  /** In-memory file content. Takes precedence over `path` when both are set. */
  buffer?: Buffer;
  /**
   * Attachment name. Required with `buffer`; defaults to the file's basename
   * with `path`.
   */
  name?: string;
  /** MIME type. Guessed from the file extension when omitted. */
  mimeType?: string;
}

/**
 * Configuration options for the TestPlanIt Playwright reporter.
 *
 * Mirrors the behaviour of `@testplanit/wdio-reporter`. Because Playwright runs
 * the reporter in a single main process (and dispatches events from every
 * worker to it), there is no need for the worker-coordination machinery the
 * WebdriverIO reporter relies on — so there is no `oneReport` option and no
 * separate launcher service.
 */
export interface TestPlanItReporterOptions {
  /**
   * The base URL of your TestPlanIt instance
   * @example 'https://testplanit.example.com'
   */
  domain: string;

  /**
   * API token for authentication.
   * Generate this from TestPlanIt: Settings > API Tokens.
   * Should start with 'tpi_'.
   */
  apiToken: string;

  /**
   * The project ID in TestPlanIt where results will be reported
   */
  projectId: number;

  /**
   * Existing test run to add results to (ID or name).
   * If a string is provided, the system looks up the test run by exact name match.
   * If not provided, a new test run is created.
   */
  testRunId?: number | string;

  /**
   * Name for the new test run.
   * Supports placeholders:
   * - {date} - Current date (YYYY-MM-DD)
   * - {time} - Current time (HH:MM:SS)
   * - {browser} - Playwright project name of the first reported test (e.g. 'chromium')
   * - {platform} - Platform/OS name
   * - {spec} - Spec file name (without .spec.ts extension) of the first reported test
   * - {suite} - Root describe title of the first reported test
   * @default '{suite} - {date} {time}'
   */
  runName?: string;

  /**
   * Test run type to indicate the test framework being used.
   * Playwright results are stored as JUnit-style results, so this defaults to
   * 'JUNIT'. Override if you need a specific type.
   * @default 'JUNIT'
   */
  testRunType?: 'REGULAR' | 'JUNIT' | 'TESTNG' | 'XUNIT' | 'NUNIT' | 'MSTEST' | 'MOCHA' | 'CUCUMBER';

  /**
   * Configuration to associate with the test run (ID or name).
   * If a string is provided, the system looks up the configuration by exact name match.
   */
  configId?: number | string;

  /**
   * Milestone to associate with the test run (ID or name).
   * If a string is provided, the system looks up the milestone by exact name match.
   */
  milestoneId?: number | string;

  /**
   * Workflow state for the test run (ID or name).
   * If a string is provided, the system looks up the state by exact name match.
   */
  stateId?: number | string;

  /**
   * Parent folder for auto-created test cases (ID or name).
   * If a string is provided, the system looks up the folder by exact name match.
   */
  parentFolderId?: number | string;

  /**
   * Template for auto-created test cases (ID or name).
   * If a string is provided, the system looks up the template by exact name match.
   */
  templateId?: number | string;

  /**
   * Tags to apply to the test run (IDs or names).
   * If strings are provided, the system looks up each tag by exact name match.
   * Tags that don't exist are created automatically.
   */
  tagIds?: (number | string)[];

  /**
   * Playwright annotation `type` used to link a test to one or more case IDs
   * without touching the test title — the recommended approach for established
   * suites. The annotation's `description` holds the case ID(s); any non-digit
   * characters are ignored, so `'1234'`, `'C1234'`, and `'1234, 1235'` all work.
   * Add multiple annotations of this type to link multiple cases.
   *
   * Set to an empty string to disable annotation-based linking.
   *
   * @default 'testplanit'
   *
   * @example
   * ```typescript
   * test('logs in', { annotation: { type: 'testplanit', description: '1234' } }, async () => {});
   * ```
   */
  caseIdAnnotation?: string;

  /**
   * Regular expression pattern to extract test case IDs from test titles
   * **and Playwright tags**. The pattern MUST include a capturing group that
   * captures the numeric case ID. Applied to each `test.tags` entry too, so a
   * tag like `@C1234` links the case when the pattern matches it.
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
   */
  caseIdPattern?: RegExp | string;

  /**
   * Whether to automatically create test cases in TestPlanIt if they don't exist.
   * Test cases are matched by className (describe path) + name (test title).
   * Requires `parentFolderId` and `templateId`.
   * @default false
   */
  autoCreateTestCases?: boolean;

  /**
   * Whether to capture Playwright `test.step()` calls as authored steps on
   * test cases that the reporter creates. Each `test.step()` title becomes a
   * step (nested steps are flattened in execution order and prefixed to show
   * their depth). Only applies to newly created cases — existing/linked cases
   * are never modified. Requires `autoCreateTestCases`.
   * @default true
   */
  captureSteps?: boolean;

  /**
   * Whether to overwrite the steps of an **existing** case with the captured
   * `test.step()` calls every run — keeping the case in sync as the script
   * changes. Applies to cases linked by ID and to cases matched by
   * auto-create. Existing steps are soft-deleted and replaced.
   *
   * This is **destructive**: any manual edits to a case's steps are discarded
   * on the next run. As a safeguard, a test with no `test.step()` calls never
   * clears existing steps. Off by default.
   * @default false
   */
  overwriteSteps?: boolean;

  /**
   * Whether to create folder hierarchy based on the describe-block structure.
   * When enabled, nested `test.describe` blocks create nested folders:
   * describe('Suite A') > describe('Suite B') > test('...')
   * creates folders: parentFolderId > Suite A > Suite B, and the test case is
   * placed in the innermost folder.
   * Requires `autoCreateTestCases` and `parentFolderId`.
   * @default false
   */
  createFolderHierarchy?: boolean;

  /**
   * Whether to upload Playwright attachments (screenshots, videos, traces, and
   * any custom `testInfo.attach(...)` outputs) to the JUnit result.
   * @default true
   */
  uploadAttachments?: boolean;

  /**
   * Restrict which attachments are uploaded. Each entry matches an attachment
   * when it equals the attachment `name` (e.g. 'screenshot', 'video', 'trace')
   * or is a prefix of its `contentType` (e.g. 'image/', 'image/png', 'video/').
   * When omitted, every attachment is uploaded.
   *
   * @example
   * // Screenshots only (mirrors the WebdriverIO reporter)
   * attachmentTypes: ['image/']
   *
   * @example
   * // Screenshots and videos, but not traces
   * attachmentTypes: ['image/', 'video/']
   */
  attachmentTypes?: string[];

  /**
   * Whether to include test error stack traces in results
   * @default true
   */
  includeStackTrace?: boolean;

  /**
   * Links to attach to the test run right after the reporter creates it
   * (e.g. a CI build URL). Rendered as clickable link attachments on the run
   * detail page.
   *
   * All string values support `{env:VAR}` placeholders resolved from
   * `process.env`. A link whose `url` references an unset environment
   * variable is skipped (with a logged warning) instead of producing a
   * broken link. Failures are logged and never fail the test run.
   *
   * Only applied when the reporter creates the run itself — skipped when
   * appending to an existing run via `testRunId`, so re-runs don't attach
   * duplicates.
   *
   * @example
   * runLinks: [{ url: '{env:BUILD_URL}', name: '{env:JOB_NAME} #{env:BUILD_NUMBER}' }]
   */
  runLinks?: RunLinkInput[];

  /**
   * Files to attach to the test run (e.g. logs, HTML reports, videos).
   * `path` values support `{env:VAR}` placeholders.
   *
   * A `path` that cannot be read when the run is created (typical for
   * artifacts produced by the tests themselves) is retried once after all
   * tests finish, just before the run is completed. Failures are logged and
   * never fail the test run. Like `runLinks`, only applied when the reporter
   * creates the run itself.
   *
   * @example
   * runAttachments: [{ path: './playwright-report/index.html', name: 'HTML Report' }]
   */
  runAttachments?: RunAttachmentInput[];

  /**
   * Key/value metadata written to the run's documentation right after the
   * run is created, rendered as `**key:** value` lines on the run detail
   * page. String values support `{env:VAR}` placeholders; an entry whose
   * value only references unset environment variables is skipped. Failures
   * are logged and never fail the test run. Like `runLinks`, only applied
   * when the reporter creates the run itself.
   *
   * @example
   * runMetadata: { version: '{env:APP_VERSION}', triggeredBy: 'jenkins' }
   */
  runMetadata?: RunMetadata;

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
}

/**
 * Internal test result tracked by the reporter
 */
export interface TrackedTestResult {
  /** Test case ID from TestPlanIt (parsed from title) */
  caseId?: number;
  /** Suite/class name (joined describe path) */
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
  status: 'passed' | 'failed' | 'skipped';
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
  /** Playwright project name (≈ browser) */
  browser?: string;
  /** Platform/OS name */
  platform?: string;
  /** Retry attempt number (0-based) */
  retryAttempt: number;
  /** Unique identifier for this test attempt */
  uid: string;
  /** Spec file path */
  specFile?: string;
  /** Captured stdout */
  systemOut?: string;
  /** Captured stderr */
  systemErr?: string;
  /** JUnit test result ID (set after the result is created) */
  junitResultId?: number;
  /**
   * Flattened `test.step()` titles (in execution order, nested steps prefixed
   * to show depth). Populated only when step capture is enabled; used to seed
   * authored steps on auto-created cases.
   */
  stepTitles?: string[];
}

/**
 * A Playwright attachment captured for deferred upload.
 */
export interface PendingAttachment {
  name: string;
  contentType: string;
  path?: string;
  body?: Buffer;
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
 * Statistics tracked during the test run for the final summary
 */
export interface ReporterStats {
  /** Number of test cases that matched existing cases in TestPlanIt */
  testCasesFound: number;
  /** Number of test cases that were newly created in TestPlanIt */
  testCasesCreated: number;
  /** Number of test cases that were moved from deleted folders */
  testCasesMoved: number;
  /** Number of authored steps created on auto-created test cases */
  testStepsCreated: number;
  /** Number of folders that were created for hierarchy */
  foldersCreated: number;
  /** Number of test results reported (passed) */
  resultsPassed: number;
  /** Number of test results reported (failed) */
  resultsFailed: number;
  /** Number of test results reported (skipped) */
  resultsSkipped: number;
  /** Number of attachments uploaded */
  attachmentsUploaded: number;
  /** Number of attachment upload failures */
  attachmentsFailed: number;
  /** Number of API errors encountered */
  apiErrors: number;
  /** Start time of the test run */
  startTime: Date;
}

/**
 * Reporter state
 */
export interface ReporterState {
  /** Created test run ID */
  testRunId?: number;
  /** Created JUnit test suite ID */
  testSuiteId?: number;
  /** Resolved numeric IDs from name lookups */
  resolvedIds: ResolvedIds;
  /** Map of test UID to tracked result */
  results: Map<string, TrackedTestResult>;
  /** Map of repository case keys to in-flight/resolved IDs */
  caseIdMap: Map<string, Promise<number>>;
  /** Map of test run case keys to in-flight/resolved IDs */
  testRunCaseMap: Map<string, Promise<number>>;
  /** Map of case IDs to an in-flight/resolved step-write, so steps are written once per case per run */
  caseStepsMap: Map<number, Promise<void>>;
  /** Map of folder paths (joined by >) to in-flight/resolved folder IDs */
  folderPathMap: Map<string, Promise<number>>;
  /** Status ID mappings */
  statusIds: {
    passed?: number;
    failed?: number;
    skipped?: number;
    blocked?: number;
  };
  /** Whether initialization is complete */
  initialized: boolean;
  /** Initialization error if any */
  initError?: Error;
  /** Statistics for the final summary */
  stats: ReporterStats;
}
