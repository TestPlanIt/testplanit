import type { Reporters } from '@wdio/types';
import type { Attachment, RunMetadata } from '@testplanit/api';

/**
 * A link attached at the test-run level (e.g. a CI build URL).
 * All string values support `{env:VAR}` placeholders when used in
 * {@link TestPlanItServiceOptions.runLinks}.
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
 * placeholders when used in {@link TestPlanItServiceOptions.runAttachments}.
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
 * Runtime API installed on the WebdriverIO `browser` object (as
 * `browser.testplanit`) by the TestPlanItService in every worker process.
 * All methods resolve to the single service-managed test run regardless of
 * which worker calls them, and never throw — failures are logged and
 * swallowed so they can't fail the test run.
 */
export interface TestPlanItRuntimeApi {
  /**
   * Attach a link (`{ url, name? }`) or a file (`{ path | buffer, name?,
   * mimeType? }`) to the current test run. Returns the created attachment,
   * or null if the run could not be resolved or the call failed.
   */
  attachToRun(input: RunLinkInput | RunAttachmentInput): Promise<Attachment | null>;
  /**
   * Merge key/value metadata into the current run's documentation (rendered
   * as `**key:** value` lines on the run detail page). Existing keys are
   * updated, new keys appended. Returns false if the call failed.
   */
  setRunMetadata(metadata: RunMetadata): Promise<boolean>;
  /** The managed test run's ID, or undefined if no run is active. */
  getRunId(): number | undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace WebdriverIO {
    interface Browser {
      /** Installed by TestPlanItService in each worker (see {@link TestPlanItRuntimeApi}). */
      testplanit?: TestPlanItRuntimeApi;
    }
  }
}

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
   * Opt-in strategy to resolve an existing case by a **custom field value**
   * parsed from the test title, tried BEFORE the name + className + source
   * matching / `autoCreateTestCases` fallback.
   *
   * Use this when your titles carry a legacy external identifier — e.g. an ID
   * left over from a previous test manager — that was backfilled onto migrated
   * cases as a custom field, rather than a TestPlanIt case ID. This is distinct
   * from `caseIdPattern`, which treats the number it captures as a literal
   * TestPlanIt case ID.
   *
   * On a match, the result is attached **directly** to that case regardless of
   * its `source` (typically `MANUAL`); no new case, folder, or link is created.
   * On no match — or if the named field doesn't exist on the project's template
   * — it falls through to the standard flow without error.
   *
   * @default undefined (disabled)
   *
   * @example
   * // Attach to a migrated manual case by its backfilled external ID.
   * // Title: "89434 Verify 'Relevance' is the default sort order"
   * matchByCustomField: { fieldName: 'External ID' }
   */
  matchByCustomField?: {
    /** Custom field display name to match on (e.g. `'External ID'`). */
    fieldName: string;
    /**
     * Pattern to extract the identifier from the test title. The first
     * capturing group (or, if the pattern has none, the whole match) is looked
     * up against `fieldName`. A leading `g` flag is ignored (a single match is
     * taken). Independent of `caseIdPattern`.
     * @default /^(\d+)/ - a bare leading number, e.g. "89434 Verify ..."
     */
    idPattern?: RegExp | string;
  };

  /**
   * Whether to automatically create test cases in TestPlanIt if they don't exist
   * Test cases are matched by className (suite name) + name (test title)
   * @default false
   */
  autoCreateTestCases?: boolean;

  /**
   * Whether to capture a Cucumber scenario's Given/When/Then steps as the
   * created case's Steps. Only effective with `@wdio/cucumber-framework`
   * (`scenarioLevelReporter: false`, the default) and `autoCreateTestCases`.
   * Given → Precondition (Step 0), When → Step, Then → Expected Result on the
   * preceding When group. Silent no-op for Mocha/Jasmine (no native steps).
   * @default true
   */
  captureSteps?: boolean;

  /**
   * Whether to overwrite the steps of an existing/linked Cucumber case with the
   * scenario's captured steps every run. Existing steps are soft-deleted and
   * replaced. This is **destructive**: any manual edits are discarded. As a
   * safeguard, a scenario with no steps never clears existing steps. No-op for
   * Mocha/Jasmine.
   * @default false
   */
  overwriteSteps?: boolean;

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
   * Whether to exclude skipped tests from the report. When enabled, skipped
   * (and pending) results — including Cucumber scenarios whose steps were
   * skipped — are not sent to TestPlanIt at all: they don't appear on the run
   * and don't count toward its totals.
   * @default false
   */
  excludeSkipped?: boolean;

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
 * Configuration options for the TestPlanIt WDIO launcher service.
 *
 * The service runs in the main WDIO process and manages the test run lifecycle:
 * - Creates the test run before any workers start (onPrepare)
 * - Completes the test run after all workers finish (onComplete)
 *
 * This ensures all spec files across all worker batches report to a single test run,
 * regardless of `maxInstances` or execution order.
 *
 * @example
 * ```javascript
 * // wdio.conf.js
 * import { TestPlanItService } from '@testplanit/wdio-reporter';
 *
 * export const config = {
 *   services: [
 *     [TestPlanItService, {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       runName: 'Automated Tests - {date}',
 *     }]
 *   ],
 *   reporters: [
 *     ['@testplanit/wdio-reporter', {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       autoCreateTestCases: true,
 *       parentFolderId: 10,
 *       templateId: 1,
 *     }]
 *   ]
 * }
 * ```
 */
export interface TestPlanItServiceOptions {
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
   * Name for the test run.
   * Supports placeholders:
   * - {date} - Current date (YYYY-MM-DD)
   * - {time} - Current time (HH:MM:SS)
   * - {platform} - Platform/OS name
   *
   * Note: {browser}, {spec}, and {suite} are NOT available since the service
   * runs before any workers start. They will be replaced with fallback values.
   *
   * @default 'Automated Tests - {date} {time}'
   */
  runName?: string;

  /**
   * Test run type to indicate the test framework being used.
   * @default 'MOCHA'
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
   * Tags to apply to the test run (IDs or names).
   * If strings are provided, the system will look up each tag by exact name match.
   * Tags that don't exist will be created automatically.
   */
  tagIds?: (number | string)[];

  /**
   * Links to attach to the test run right after it is created (e.g. a CI
   * build URL). Applied exactly once, in the launcher process. Rendered as
   * clickable link attachments on the run detail page.
   *
   * All string values support `{env:VAR}` placeholders resolved from
   * `process.env`. A link whose `url` references an unset environment
   * variable is skipped (with a logged warning) instead of producing a
   * broken link. Failures are logged and never fail the test run.
   *
   * @example
   * runLinks: [{ url: '{env:BUILD_URL}', name: '{env:JOB_NAME} #{env:BUILD_NUMBER}' }]
   */
  runLinks?: RunLinkInput[];

  /**
   * Files to attach to the test run (e.g. logs, HTML reports, videos).
   * Applied exactly once, in the launcher process. `path` values support
   * `{env:VAR}` placeholders.
   *
   * A `path` that does not exist yet when the run is created (typical for
   * artifacts produced by the tests themselves) is retried once after all
   * workers finish, just before the run is completed. Failures are logged
   * and never fail the test run.
   *
   * @example
   * runAttachments: [{ path: './logs/wdio.log', name: 'wdio.log' }]
   */
  runAttachments?: RunAttachmentInput[];

  /**
   * Key/value metadata written to the run's documentation right after the
   * run is created, rendered as `**key:** value` lines on the run detail
   * page. String values support `{env:VAR}` placeholders; an entry whose
   * value only references unset environment variables is skipped. Failures
   * are logged and never fail the test run.
   *
   * @example
   * runMetadata: { version: '{env:APP_VERSION}', triggeredBy: 'jenkins' }
   */
  runMetadata?: RunMetadata;

  /**
   * Whether to mark the test run as completed when all workers finish
   * @default true
   */
  completeRunOnFinish?: boolean;

  /**
   * Automatically capture a screenshot when a test fails.
   * The screenshot is taken via the WDIO `afterTest` hook and is
   * automatically uploaded by the reporter when `uploadScreenshots`
   * is enabled (the default).
   * @default false
   */
  captureScreenshots?: boolean;

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
  /**
   * Ordered Cucumber step titles (keyword embedded, e.g. "Given I am on the
   * homepage") accumulated for a scenario. Set only when
   * `detectedFramework === 'cucumber'`; used to derive the case's Steps.
   */
  cucumberStepTitles?: string[];
  /**
   * Ordered low-level automation commands the test executed (non-Cucumber),
   * captured via onBeforeCommand and fed to AI step derivation.
   */
  commands?: string[];
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
  /** Number of folders that were created for hierarchy */
  foldersCreated: number;
  /** Number of case Steps written from captured Cucumber scenario steps */
  testStepsCreated: number;
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
  /** Resolved numeric IDs from name lookups */
  resolvedIds: ResolvedIds;
  /** Map of test UID to tracked result */
  results: Map<string, TrackedTestResult>;
  /** Map of repository case keys to IDs */
  caseIdMap: Map<string, number>;
  /** Map of test run case keys to IDs */
  testRunCaseMap: Map<string, number>;
  /**
   * Cache of custom-field resolutions ("fieldName::value" → matched case ID, or
   * null for a confirmed miss) so a repeated title (e.g. a retried test) does
   * not re-query. Only used when `matchByCustomField` is configured.
   */
  customFieldCaseMap: Map<string, number | null>;
  /** Map of folder paths (joined by >) to folder IDs for caching */
  folderPathMap: Map<string, number>;
  /** Dedup of in-flight step writes per case id (write steps at most once per case per run) */
  caseStepsMap: Map<number, Promise<void>>;
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
