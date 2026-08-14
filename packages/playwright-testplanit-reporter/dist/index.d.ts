import { Reporter, FullConfig, Suite, TestCase, TestResult, TestError, FullResult } from '@playwright/test/reporter';
import { RunMetadata } from '@testplanit/api';
export { Attachment, RepositoryCase, RunMetadata, Status, TestPlanItClient, TestPlanItError, TestRun, TestRunResult } from '@testplanit/api';

/**
 * A link attached at the test-run level (e.g. a CI build URL).
 * All string values support `{env:VAR}` placeholders when used in
 * {@link TestPlanItReporterOptions.runLinks}.
 */
interface RunLinkInput {
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
interface RunAttachmentInput {
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
interface TestPlanItReporterOptions {
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
     *
     * A run supplied here (or via the `TESTPLANIT_RUN_ID` environment variable) is
     * externally managed: the reporter attaches results to it but never creates or
     * completes it, so any number of shards, machines or retry waves can report
     * into the same run. Resolution order is:
     *
     * 1. `testRunId` as a number
     * 2. `TESTPLANIT_RUN_ID` (numeric)
     * 3. `testRunId` as a name to look up
     * 4. create a new run
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
     * - {shard} - Playwright's `--shard` as 'current/total' (e.g. '2/5'), '1/1' when unsharded
     * - {suite} - Root describe title of the first reported test
     * @default '{suite} - {date} {time}'
     */
    runName?: string;
    /**
     * Name of the JUnit test suite created for this execution's results.
     * Supports the same placeholders as {@link runName}.
     *
     * Each execution creates its own suite, so with an externally managed run the
     * default distinguishes shards by project and spec — use `{shard}` for a
     * precise label when running `--shard`. Results roll up at the run level
     * regardless of how many suites it holds.
     *
     * @default runName, or '{suite} - {browser}/{platform} - {spec}' for an
     * externally managed run
     */
    testSuiteName?: string;
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
     * Whether to exclude skipped tests from the report. When enabled, skipped
     * results are not sent to TestPlanIt at all — they don't appear on the run
     * and don't count toward its totals.
     * @default false
     */
    excludeSkipped?: boolean;
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
     * Whether to mark the test run as completed when all tests finish.
     *
     * Forced to false for an externally managed run (see {@link testRunId}), so a
     * single shard cannot close a run other executions are still reporting into.
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
interface TrackedTestResult {
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
    /** Worker lane the attempt ran on (Playwright parallelIndex, 0-based) */
    worker?: string;
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
interface ReporterState {
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
    /** Map of case IDs to an in-flight/settled automated-flip check, so each explicitly linked case is checked once per run */
    caseAutomatedMap: Map<number, Promise<void>>;
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

/**
 * Environment variable holding the ID of a test run created by the pipeline.
 * Every execution that sees it attaches to that run instead of creating one,
 * which is how a suite split across shards, machines or retry waves lands in a
 * single run.
 */
declare const RUN_ID_ENV_VAR = "TESTPLANIT_RUN_ID";
/**
 * Playwright reporter for TestPlanIt.
 *
 * Reports test results directly to your TestPlanIt instance. Mirrors the
 * behaviour of `@testplanit/wdio-reporter`.
 *
 * @example
 * ```typescript
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   reporter: [
 *     ['@testplanit/playwright-reporter', {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       runName: 'E2E Tests - {date} {time}',
 *     }],
 *   ],
 * });
 * ```
 */
declare class TestPlanItReporter implements Reporter {
    private client;
    private options;
    private state;
    /** Memoized initialization (create test run, fetch statuses). */
    private initPromise;
    /** Memoized JUnit suite creation. */
    private suitePromise;
    /** In-flight result-reporting / upload operations awaited in onEnd. */
    private pendingOperations;
    private reportedResultCount;
    /** Run-name placeholder context, captured from reported tests. */
    private currentSpec?;
    private currentProject?;
    private rootSuiteName?;
    /** Shard this process is running, from Playwright's `--shard` (onBegin). */
    private shard?;
    /**
     * When true, the run was created outside this reporter — pinned by the
     * `testRunId` option or the `TESTPLANIT_RUN_ID` environment variable. The
     * reporter attaches results to it but never creates, mutates or completes it.
     */
    private externallyManaged;
    /**
     * `runAttachments` entries whose file couldn't be read at initialization
     * (typically artifacts produced by the tests themselves). Retried once in
     * onEnd, before the run is completed.
     */
    private deferredRunAttachments;
    /**
     * Keys of runtime run-level ops already applied this session, so retried
     * tests (which re-run their attachToRun/setRunMetadata calls) don't create
     * duplicate run attachments.
     */
    private appliedRunOps;
    constructor(options: TestPlanItReporterOptions);
    /** Tell Playwright this reporter writes to stdout (summary + warnings). */
    printsToStdio(): boolean;
    /**
     * Record that the run belongs to the pipeline rather than this execution.
     * Completion is disabled so one shard cannot close a run that other shards,
     * machines or retry waves are still reporting into.
     */
    private markExternallyManaged;
    private log;
    private logError;
    /**
     * Track an async operation so onEnd waits for it to complete.
     */
    private trackOperation;
    onBegin(config: FullConfig, _suite: Suite): void;
    onTestEnd(test: TestCase, result: TestResult): void;
    onError(error: TestError): void;
    onEnd(_result: FullResult): Promise<void>;
    private reportResult;
    /**
     * Resolve (and cache) the repository case ID for an auto-created test case,
     * creating the folder hierarchy first when enabled.
     */
    private resolveAutoCreatedCaseId;
    /**
     * Write captured `test.step()` titles as authored steps on a case (memoized
     * so it runs once per case per run). When `replace` is set, the case's
     * existing steps are soft-deleted first — but a test with no captured steps
     * never clears anything, so an existing case is never accidentally emptied.
     *
     * Best-effort: failures are logged but never bubble up, so result reporting
     * is never blocked by step syncing.
     */
    private writeCaseSteps;
    /**
     * Flip an explicitly linked case to `automated: true` when it isn't
     * already, so a case that started manual but now receives automated results
     * reflects that in TestPlanIt. Checked once per case per run (memoized).
     * Skips the write when the case is already automated and never throws — a
     * failure logs and is swallowed so it can't abort reporting the result.
     */
    private ensureCaseAutomated;
    /** Resolve (and cache) the folder ID for a describe path. */
    private getFolderId;
    /** Add the case to the run once (memoized per case). */
    private getTestRunCaseId;
    private uploadAttachments;
    private attachmentMatches;
    private buildAttachmentNote;
    /**
     * Apply one runtime run-level operation (from an attachToRun /
     * setRunMetadata call in a test). Initializes the reporter if needed —
     * an explicit run-level call is a reason to create the run. Failures are
     * logged and swallowed; they never fail the test run.
     */
    private applyRunLevelOp;
    /**
     * Apply the declarative run-level options (`runLinks`, `runMetadata`,
     * `runAttachments`) to the just-created test run. Called once from
     * initialization, and only when the reporter created the run itself —
     * appending to an existing run (`testRunId`) skips this so re-runs don't
     * attach duplicates. Every failure is logged and swallowed.
     */
    private applyRunLevelConfig;
    /**
     * Read and upload one declarative run attachment. Returns false when a
     * path-based entry can't be read (so the caller can defer it); invalid
     * entries are logged and count as handled (true).
     */
    private uploadRunFile;
    /**
     * Retry `runAttachments` entries whose file wasn't readable at
     * initialization. Called from onEnd before the run is completed.
     */
    private applyDeferredRunAttachments;
    private initialize;
    private doInitialize;
    /**
     * Confirm a pinned run is reachable. A failure here is reported but not fatal:
     * the reporter keeps attaching results to the pinned ID rather than creating a
     * replacement run, which would reintroduce the duplicates pinning prevents.
     */
    private validateExternallyManagedTestRun;
    private resolveOptionIds;
    /** Resolve the option names that are only read when creating a test run. */
    private resolveRunFieldIds;
    private fetchStatusMappings;
    private createTestRun;
    private ensureJUnitTestSuite;
    private createJUnitTestSuite;
    private normalizeStatus;
    private mapStatusToJUnitType;
    /**
     * Extract case IDs from a test title using the configured pattern.
     * @example "[1761] [1762] should load" -> { caseIds: [1761, 1762], cleanTitle: "should load" }
     */
    private parseCaseIds;
    /**
     * Collect case IDs from annotations of the configured type, on the test and
     * the current result. The description holds the ID(s); non-digits are ignored.
     */
    private getAnnotationCaseIds;
    /** Collect case IDs from Playwright tags by applying the configured pattern. */
    private getTagCaseIds;
    /** Collect the describe-block titles (outermost first) for a test. */
    private getSuitePath;
    /** Resolve the Playwright project name (≈ browser) for a test. */
    private getProjectName;
    private joinOutput;
    private createCaseKey;
    /**
     * Flatten Playwright `test.step()` calls into ordered step titles.
     *
     * Only user steps (`category === 'test.step'`) are kept — auto-instrumented
     * categories (`pw:api`, `expect`, `hook`, `fixture`) are skipped, but we
     * still descend through them so a `test.step()` nested inside one is not
     * lost. Nested user steps are emitted in execution order and prefixed with a
     * depth marker so the hierarchy survives as plain text.
     */
    private extractStepTitles;
    /**
     * Template for this execution's JUnit suite name.
     *
     * A pinned run collects a suite per execution, so its default names them by
     * project and spec to tell shards apart. A run this reporter created holds one
     * suite, named after the run.
     */
    private resolveTestSuiteNameTemplate;
    private formatRunName;
    private extForContentType;
    private printSummary;
    /** Expose the internal state (for testing/debugging). */
    getState(): ReporterState;
}

/**
 * Run-level attachment support: links, files, and key/value metadata attached
 * to the TEST RUN itself (not to an individual result).
 *
 * Two surfaces:
 *
 * - Declarative reporter options (`runLinks` / `runAttachments` /
 *   `runMetadata`), applied by the reporter once, right after it creates the
 *   run.
 * - Runtime helpers ({@link attachToRun} / {@link setRunMetadata}) callable
 *   from tests and hooks. Playwright runs the reporter in the main process
 *   while tests run in workers, so the helpers ship the request through
 *   Playwright's own attachment transport: they call `testInfo.attach()` with
 *   a reserved `testplanit:run-*` name, and the reporter intercepts those
 *   attachments in `onTestEnd`, routing them to run-level API calls instead
 *   of uploading them to the result.
 */

/**
 * The slice of Playwright's `TestInfo` the runtime helpers need. Pass the
 * `testInfo` object your test or fixture receives.
 */
interface RunAttachTarget {
    attach(name: string, options: {
        body?: string | Buffer;
        path?: string;
        contentType?: string;
    }): Promise<void>;
}
/**
 * Attach a link or file to the test run itself (not to this test's result)
 * from inside a test or hook.
 *
 * ```typescript
 * test('deploys', async ({ page }, testInfo) => {
 *   await attachToRun(testInfo, { url: deployUrl, name: 'Deployed build' });
 *   await attachToRun(testInfo, { path: './output/report.html' });
 *   await attachToRun(testInfo, { buffer: pdf, name: 'summary.pdf' });
 * });
 * ```
 *
 * The request rides Playwright's attachment transport and is applied by the
 * reporter in the main process, exactly once per distinct link/file name —
 * retried tests don't create duplicates. Invalid input is logged and
 * ignored; it never fails the test.
 */
declare function attachToRun(testInfo: RunAttachTarget, input: RunLinkInput | RunAttachmentInput): Promise<void>;
/**
 * Merge key/value metadata into the test run's documentation from inside a
 * test or hook (rendered as `**key:** value` lines on the run detail page).
 * Existing keys are updated in place, new keys appended. Applied by the
 * reporter in the main process; identical payloads are applied only once.
 */
declare function setRunMetadata(testInfo: RunAttachTarget, metadata: RunMetadata): Promise<void>;

export { RUN_ID_ENV_VAR, type ReporterState, type RunAttachTarget, type RunAttachmentInput, type RunLinkInput, TestPlanItReporter, type TestPlanItReporterOptions, type TrackedTestResult, attachToRun, TestPlanItReporter as default, setRunMetadata };
