import WDIOReporter, { RunnerStats, SuiteStats, TestStats, BeforeCommandArgs, AfterCommandArgs } from '@wdio/reporter';
import { Reporters } from '@wdio/types';
export { RepositoryCase, Status, TestPlanItClient, TestPlanItError, TestRun, TestRunResult } from '@testplanit/api';

/**
 * Configuration options for the TestPlanIt WebdriverIO reporter
 */
interface TestPlanItReporterOptions extends Reporters.Options {
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
interface TestPlanItServiceOptions {
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
interface TrackedTestResult {
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
interface ResolvedIds {
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
interface ReporterStats {
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
interface ReporterState {
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

/**
 * WebdriverIO Reporter for TestPlanIt
 *
 * Reports test results directly to your TestPlanIt instance.
 *
 * @example
 * ```javascript
 * // wdio.conf.js
 * export const config = {
 *   reporters: [
 *     ['@testplanit/wdio-reporter', {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       runName: 'E2E Tests - {date}',
 *     }]
 *   ]
 * }
 * ```
 */
declare class TestPlanItReporter extends WDIOReporter {
    private client;
    private reporterOptions;
    private state;
    private currentSuite;
    private initPromise;
    private pendingOperations;
    private reportedResultCount;
    private detectedFramework;
    private currentTestUid;
    private currentCid;
    private pendingScreenshots;
    /**
     * Low-level automation commands captured per running test uid (via
     * onBeforeCommand), fed to AI step derivation for non-Cucumber tests so the
     * steps reflect what the test actually did. Capped per test to bound payload.
     */
    private testCommands;
    private static readonly MAX_COMMANDS_PER_TEST;
    /** Cucumber: accumulated step titles per active scenario suite uid. */
    private pendingScenarioSteps;
    /**
     * Non-Cucumber cases (no deterministic steps) collected across the run for a
     * single opt-in, batched LLM step-derivation request at onRunnerEnd. Keyed by
     * testCaseId so a case is requested at most once per run.
     */
    private llmDerivationCases;
    /** Cucumber: uid of the scenario suite currently open (null outside a scenario). */
    private currentScenarioUid;
    /** Cucumber: in-progress plan for the open scenario, emitted once at onSuiteEnd. */
    private currentScenarioPlan;
    private cucumberStepNoticeLogged;
    /** When true, the TestPlanItService manages the test run lifecycle */
    private managedByService;
    /**
     * WebdriverIO uses this getter to determine if the reporter has finished async operations.
     * The test runner will wait for this to return true before terminating.
     */
    get isSynchronised(): boolean;
    constructor(options: TestPlanItReporterOptions);
    /**
     * Log a message if verbose mode is enabled
     */
    private log;
    /**
     * Log an error (always logs, not just in verbose mode)
     */
    private logError;
    /**
     * Track an async operation to prevent the runner from terminating early.
     * The operation is added to pendingOperations and removed when complete.
     * WebdriverIO checks isSynchronised and waits until all operations finish.
     */
    private trackOperation;
    /**
     * Decide whether to write a Cucumber scenario's captured steps to its case,
     * and write them via the shared mapper. No-op for non-Cucumber frameworks
     * (D-09). Writes on fresh create when captureSteps is on (D-04), or replaces
     * existing steps when overwriteSteps is on (D-05).
     */
    private writeScenarioSteps;
    /**
     * For NON-Cucumber frameworks (Mocha/Jasmine — no deterministic steps),
     * collect a case for opt-in, server-side LLM step derivation. Gated by
     * `captureSteps` (the general "populate steps" switch). A newly created
     * stepless case is always eligible; an existing/matched case is only eligible
     * when `overwriteSteps` is on (destructive re-derive). The actual request is
     * batched and sent once at onRunnerEnd; the server is inert if the project has
     * no LLM provider configured.
     */
    private collectForLlmDerivation;
    /**
     * Send the single batched LLM step-derivation request for the non-Cucumber
     * cases collected this run. Called once at onRunnerEnd. Provider-gated +
     * inert server-side when no LLM provider is configured; wrapped so a failure
     * never affects the run.
     */
    private requestLlmDerivation;
    /**
     * Write derived case Steps for a case (ported from the Playwright reporter).
     * Dedups in-flight writes per case id; when `replace` is set, soft-deletes
     * existing steps first and SKIPS the create if the delete fails (never-clobber
     * guard, CORE-01). Passes `CaseStepRow[]` directly to `createSteps` so the
     * mapper's `expectedResult` is preserved (D-06).
     */
    private writeCaseSteps;
    /**
     * Initialize the reporter (create test run, fetch statuses)
     */
    private initialize;
    private doInitialize;
    /**
     * Resolve option names to numeric IDs
     */
    private resolveOptionIds;
    /**
     * Fetch status ID mappings from TestPlanIt
     */
    private fetchStatusMappings;
    /**
     * Map test status to JUnit result type
     */
    private mapStatusToJUnitType;
    /**
     * Create the JUnit test suite for this test run
     */
    private createJUnitTestSuite;
    /**
     * Map WebdriverIO framework name to TestPlanIt test run type
     */
    private getTestRunType;
    /**
     * Create a new test run
     */
    private createTestRun;
    /**
     * Format the run name with placeholders
     */
    private formatRunName;
    /**
     * Parse case IDs from test title using the configured pattern
     * @example With default pattern: "[1761] [1762] should load the page" -> [1761, 1762]
     * @example With C-prefix pattern: "C12345 C67890 should load the page" -> [12345, 67890]
     */
    private parseCaseIds;
    /**
     * Extract the custom-field identifier from a test title using
     * `matchByCustomField.idPattern` (default `/^(\d+)/`). Returns the first
     * capturing group, or the whole match when the pattern has no group. The
     * value is returned as a string; the API client matches it against both the
     * numeric and string forms of the stored value. Returns undefined when the
     * pattern doesn't match. Independent of `parseCaseIds`.
     */
    private parseCustomFieldId;
    /**
     * Opt-in resolution: find an existing case by a custom field value parsed
     * from the test title (see `matchByCustomField`). Returns the matched case
     * ID, or undefined to fall through to the name + className + source matching
     * / `autoCreateTestCases` flow.
     *
     * Never throws: a title the pattern doesn't match, a field that doesn't
     * exist, no matching case, or an API error all log and return undefined so
     * the standard flow still runs.
     */
    private resolveCaseByCustomField;
    /**
     * Flip a matched case to `automated: true` when it isn't already, so a case
     * that started manual but now receives automated results reflects that in
     * TestPlanIt. Skips the write when the case is already automated (no
     * redundant API call per run) and never throws — a failed update logs and is
     * swallowed so it can't abort reporting the result.
     */
    private ensureCaseAutomated;
    /**
     * Get the full suite path as a string
     */
    private getFullSuiteName;
    /**
     * Create a unique key for a test case
     */
    private createCaseKey;
    onRunnerStart(runner: RunnerStats): void;
    onSuiteStart(suite: SuiteStats): void;
    onSuiteEnd(suite: SuiteStats): void;
    onTestStart(test: TestStats): void;
    /**
     * Capture the ordered low-level automation commands a test runs. Fed to AI
     * step derivation (non-Cucumber) so the steps mirror what the test actually
     * did. Cheap no-op outside a test / when nothing is being captured.
     */
    onBeforeCommand(commandArgs: BeforeCommandArgs): void;
    /**
     * Render a WebdriverIO command into a compact one-line string for the LLM,
     * e.g. `navigateTo {"url":"https://app/login"}` or `elementSendKeys {"text":"a@b.com"}`.
     * Returns null for commands with no useful signal.
     */
    private formatCommand;
    /**
     * Capture screenshots from WebdriverIO commands
     */
    onAfterCommand(commandArgs: AfterCommandArgs): void;
    onTestPass(test: TestStats): void;
    onTestFail(test: TestStats): void;
    onTestSkip(test: TestStats): void;
    /**
     * Handle test completion
     */
    private handleTestEnd;
    /**
     * Report a single test result to TestPlanIt
     */
    private reportResult;
    /**
     * Called when the entire test session ends
     */
    onRunnerEnd(runner: RunnerStats): Promise<void>;
    /**
     * Get the current state (for debugging)
     */
    getState(): ReporterState;
}

/**
 * WebdriverIO Launcher Service for TestPlanIt.
 *
 * Manages the test run lifecycle in the main WDIO process:
 * - onPrepare: Creates the test run and JUnit test suite ONCE before any workers start
 * - onComplete: Completes the test run ONCE after all workers finish
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
 *       runName: 'E2E Tests - {date}',
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
 *
 * @packageDocumentation
 */

/**
 * WebdriverIO Launcher Service for TestPlanIt.
 *
 * Creates a single test run before any workers start and completes it
 * after all workers finish. Workers read the shared state file to find
 * the pre-created test run and report results to it.
 */
declare class TestPlanItService {
    private options;
    private client;
    private verbose;
    private testRunId?;
    private testSuiteId?;
    constructor(serviceOptions: TestPlanItServiceOptions);
    /**
     * Log a message if verbose mode is enabled
     */
    private log;
    /**
     * Log an error (always logs, not just in verbose mode)
     */
    private logError;
    /**
     * Format run name with available placeholders.
     * Note: {browser}, {spec}, and {suite} are NOT available in the service context
     * since it runs before any workers start.
     */
    private formatRunName;
    /**
     * Resolve string option IDs to numeric IDs using the API client.
     */
    private resolveIds;
    /**
     * onPrepare - Runs once in the main process before any workers start.
     *
     * Creates the test run and JUnit test suite, then writes shared state
     * so all worker reporters can find and use the pre-created run.
     */
    onPrepare(): Promise<void>;
    /**
     * afterTest - Runs in each worker process after each test.
     *
     * Captures a screenshot on test failure when `captureScreenshots` is enabled.
     * The screenshot is intercepted and uploaded by the reporter automatically.
     */
    afterTest(_test: Record<string, unknown>, _context: Record<string, unknown>, result: {
        error?: Error;
        passed: boolean;
    }): Promise<void>;
    /**
     * onComplete - Runs once in the main process after all workers finish.
     *
     * Completes the test run and cleans up the shared state file.
     */
    onComplete(exitCode: number): Promise<void>;
}

export { type ReporterState, TestPlanItReporter, type TestPlanItReporterOptions, TestPlanItService, type TestPlanItServiceOptions, type TrackedTestResult, TestPlanItReporter as default };
