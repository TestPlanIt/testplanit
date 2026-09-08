/**
 * TestPlanIt API Types
 * Based on the TestPlanIt OpenAPI schema and Prisma models
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
interface Project {
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
interface Configuration {
    id: number;
    projectId: number;
    name: string;
    description?: string | null;
    isDeleted: boolean;
}
/**
 * Milestone (release/sprint)
 */
interface Milestone {
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
interface WorkflowState {
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
interface RepositoryFolder {
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
interface CreateFolderOptions {
    projectId: number;
    name: string;
    parentId?: number;
}
/**
 * Test case template
 */
interface Template {
    id: number;
    templateName: string;
    isDefault: boolean;
    isEnabled: boolean;
    isDeleted: boolean;
}
/**
 * Tag (global, not project-scoped)
 */
interface Tag {
    id: number;
    name: string;
    isDeleted: boolean;
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
interface RepositoryCase {
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
 * Authored step on a test case.
 * `step`/`expectedResult` hold a TipTap rich-text document (matching the
 * in-app step editor).
 */
interface Step {
    id: number;
    testCaseId: number;
    step?: unknown;
    expectedResult?: unknown;
    order: number;
    isDeleted: boolean;
}
/**
 * Test case linked to a test run
 */
interface TestRunCase {
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
interface TestRunResult {
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
interface TestRunStepResult {
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
interface Attachment {
    id: number;
    name: string;
    url: string;
    size: number;
    mimeType: string;
    note?: string | null;
    createdAt: string;
    createdById: string;
    isDeleted: boolean;
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
interface User {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    isDeleted: boolean;
}
/**
 * Comment on a test run or other entity
 */
interface Comment {
    id: number;
    content: Record<string, unknown>;
    createdAt: string;
    createdById: string;
    updatedAt?: string | null;
    isDeleted: boolean;
    testRunId?: number | null;
    repositoryCaseId?: number | null;
    sessionId?: number | null;
}
/**
 * Issue/defect linked to test results
 */
interface Issue {
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
/**
 * JUnit result type enum
 */
type JUnitResultType = 'PASSED' | 'FAILURE' | 'ERROR' | 'SKIPPED';
/**
 * JUnit test suite (for automated test results)
 */
interface JUnitTestSuite {
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
interface JUnitTestResult {
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
    worker?: string | null;
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
interface JUnitProperty {
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
interface JUnitTestStep {
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
    tagIds?: number[];
    note?: Record<string, unknown>;
    docs?: Record<string, unknown>;
}
/**
 * Options for updating a test run
 */
interface UpdateTestRunOptions {
    name?: string;
    isCompleted?: boolean;
    completedAt?: Date | string | null;
    configId?: number | null;
    milestoneId?: number | null;
    stateId?: number;
    note?: Record<string, unknown> | null;
    docs?: Record<string, unknown> | null;
    /** ZenStack relation syntax for updating the workflow state */
    state?: {
        connect: {
            id: number;
        };
    };
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
 * Options for {@link TestPlanItClient.updateTestCase} — a minimal,
 * forward-compatible partial update of an existing test case. Only the fields
 * present here are written, so more fields can be added later without a
 * breaking change. Relation fields (folder, template, state, …) are out of
 * scope; use the dedicated helpers for those.
 */
interface UpdateTestCaseOptions {
    /** Whether the case is driven by automation (shown as "automated" in the UI). */
    automated?: boolean;
}
/**
 * A single step on a case created via {@link TestPlanItClient.createTestCases}.
 * Plain-text `text`/`expectedResult` are stored as TipTap rich-text documents
 * server-side so they render in the in-app step editor.
 */
interface BulkTestCaseStep {
    /** Step instruction (plain text). */
    text?: string;
    /** Expected result (plain text). */
    expectedResult?: string;
    /** Zero-based position; inferred from array order when omitted. */
    order?: number;
}
/** One case in a {@link TestPlanItClient.createTestCases} batch. */
interface BulkTestCaseInput {
    name: string;
    /** Override the batch folder for this case. */
    folderId?: number;
    /** Override the batch workflow state (by name) for this case. */
    stateName?: string;
    steps?: BulkTestCaseStep[];
    /** Tag IDs (numbers) or tag names (strings, created if missing). */
    tags?: Array<number | string>;
    /**
     * Custom field values keyed by display name (e.g. `{ Priority: "High" }`).
     * Validated against the chosen template; a field not on the template is
     * reported as a per-case error, never silently dropped.
     */
    customFields?: Record<string, unknown>;
}
/** Options for {@link TestPlanItClient.createTestCases} (bulk create). */
interface CreateTestCasesOptions {
    projectId: number;
    /**
     * Default folder for the batch. Each case may override it via
     * {@link BulkTestCaseInput.folderId}.
     */
    folderId: number;
    /** Template for the batch. Defaults to the project's first enabled template. */
    templateId?: number;
    /** Default CASES workflow state name; each case may override it. */
    stateName?: string;
    cases: BulkTestCaseInput[];
}
/** Per-case outcome from {@link TestPlanItClient.createTestCases}. */
interface BulkTestCaseResult {
    /** Index-based id echoing the case's position in the request (`"0"`, `"1"`, …). */
    id: string;
    name: string;
    status: "success" | "error";
    /** Present on success — the created RepositoryCase id. */
    caseId?: number;
    /** Present on error — the failure message for this case. */
    error?: string;
}
/** Result of {@link TestPlanItClient.createTestCases}. */
interface CreateTestCasesResult {
    success: boolean;
    importedCount: number;
    failedCount: number;
    results: BulkTestCaseResult[];
}
/**
 * Options for creating an authored step on a test case.
 * Plain-text `step`/`expectedResult` are stored as TipTap rich-text documents
 * so they render in the in-app step editor.
 */
interface CreateStepOptions {
    testCaseId: number;
    /** Step instruction (plain text). */
    step: string;
    /** Expected result (plain text). Omitted when empty. */
    expectedResult?: string;
    /** Zero-based position of the step within the case. */
    order: number;
}
/**
 * Options for creating multiple authored steps on a test case in one request.
 * Each step's plain-text `step`/`expectedResult` is stored as a TipTap doc.
 */
interface CreateStepsOptions {
    testCaseId: number;
    steps: Array<{
        /** Step instruction (plain text). */
        step: string;
        /** Expected result (plain text). Omitted when empty. */
        expectedResult?: string;
        /** Zero-based position of the step within the case. */
        order: number;
    }>;
}
/** One case to request server-side LLM step derivation for. */
interface RequestStepDerivationCase {
    testCaseId: number;
    /** The automated test's name — the primary signal the LLM derives from. */
    name: string;
    /** Suite/class the test belongs to, if any. */
    className?: string | null;
    /** Failure message from the result, if any. */
    failure?: string | null;
    /** Captured output from the result, if any. */
    systemOut?: string | null;
    /**
     * Ordered low-level automation commands the test executed (e.g. navigate,
     * find element, click, type, assert), if captured. When present, the model
     * derives steps from what the test actually did rather than only its name.
     */
    commands?: string[];
}
interface RequestStepDerivationOptions {
    projectId: number;
    /** Test run the resulting "steps ready" notification links to. */
    testRunId: number;
    cases: RequestStepDerivationCase[];
    /**
     * Destructive opt-in: re-derive cases that already have steps (replace them).
     * Default false (only stepless cases are enriched).
     */
    overwrite?: boolean;
}
/** Whether QuickScript emits one combined file or one file per case. */
type QuickScriptOutputMode = 'combined' | 'perCase';
interface GenerateQuickScriptOptions {
    projectId: number;
    /** Stored test cases to generate a script from (1–50). */
    caseIds: number[];
    /**
     * Export template to use. Omit to use the project's default/assigned template.
     * When a code repository is connected, generation follows the repo's existing
     * framework/fixtures over the template's framework (intended behavior).
     */
    templateId?: number;
    /**
     * "combined" (default): a single file containing all cases.
     * "perCase": one generated file per case.
     */
    outputMode?: QuickScriptOutputMode;
    /**
     * Override the request timeout (ms) for this call. Generation invokes an LLM
     * and can be slow; defaults to 180000 (well above the client's default).
     */
    timeoutMs?: number;
}
/** One generated script file returned by {@link GenerateQuickScriptResult}. */
interface QuickScriptFile {
    /** The generated script text. */
    code: string;
    /**
     * "ai" when the LLM produced the script; "template" when generation fell back
     * to the deterministic template render (LLM failure or no integration).
     */
    generatedBy: 'ai' | 'template';
    /** Present when generatedBy=template due to an LLM failure / no integration. */
    error?: string;
    /** True when the AI hit its token limit and output was cut off. */
    truncated?: boolean;
    caseId: number;
    caseName: string;
    /** Repository file paths included as AI context (absent when no repo connected). */
    contextFiles?: string[];
}
interface GenerateQuickScriptResult {
    projectId: number;
    /** The export template that was resolved and used. */
    templateId: number;
    templateName: string;
    /** Resolved framework (may come from the connected repo, not the template). */
    framework: string;
    language: string;
    /** e.g. ".spec.ts" — suitable for naming the written file. */
    fileExtension: string;
    outputMode: QuickScriptOutputMode;
    /** Whether repository context was available and fed to the model. */
    hasCodeContext: boolean;
    /** Requested caseIds not found in the project (omitted when all resolved). */
    missingCaseIds?: number[];
    results: QuickScriptFile[];
}
/**
 * A single normalized automation step, produced by a per-surface adapter
 * (the result importer, or the Playwright / WDIO reporters) and consumed by
 * `automationStepsToCaseSteps`. Format-agnostic: native shapes (Cucumber
 * Gherkin keywords, Playwright `TestStep` trees) are mapped to this
 * intermediate so the shared mapper never parses a native format itself.
 */
interface AutomationStep {
    /** Plain-text step text (keyword-stripped for Gherkin). */
    title: string;
    /** Role of the step: Given → precondition, When → action, Then → assertion. */
    kind: "precondition" | "action" | "assertion";
    /** Nested steps (e.g. a Playwright `expect` nested under a `test.step`). */
    children?: AutomationStep[];
}
/**
 * A single derived case `Steps` row in plain-text form. The caller wraps
 * `step`/`expectedResult` into TipTap-JSON on write via `tipTapDoc`; the
 * mapper itself stays a pure text transform. Structurally identical to an
 * element of {@link CreateStepsOptions.steps}, so a `CaseStepRow[]` is
 * directly assignable to `createSteps({ testCaseId, steps })`.
 */
interface CaseStepRow {
    /** Step instruction (plain text). */
    step: string;
    /** Expected result (plain text). Omitted/empty when not applicable — empty is valid. */
    expectedResult?: string;
    /** Zero-based position of the step within the case. */
    order: number;
}
/**
 * Result of findOrCreateTestCase with metadata
 */
interface FindOrCreateTestCaseResult {
    testCase: RepositoryCase;
    /** How the test case was resolved */
    action: 'found' | 'created' | 'moved';
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
 * Options for uploading attachments
 */
interface UploadAttachmentOptions {
    testRunResultId: number;
    file: Blob | Buffer;
    fileName: string;
    mimeType?: string;
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
    isDeleted?: boolean;
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
    folderId?: number;
    isDeleted?: boolean;
}
/**
 * Options for {@link TestPlanItClient.findTestCaseByCustomField}.
 *
 * Resolves a case by a custom field value rather than by
 * name/className/source, so an automated run can attach to a manually-authored
 * case that carries a legacy external identifier (e.g. an ID backfilled onto
 * migrated MANUAL cases as an Integer custom field).
 */
interface FindTestCaseByCustomFieldOptions {
    projectId: number;
    /** Custom field display name to match on (e.g. `"External ID"`). */
    fieldName: string;
    /**
     * Value to match against the field. Compared against the stored JSON value
     * in both its number and string forms, so resolution does not depend on
     * whether the field type persists as a JSON number (Integer/Number) or a
     * JSON string (Text).
     */
    value: string | number;
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
 * Options for creating a JUnit test suite
 */
interface CreateJUnitTestSuiteOptions {
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
interface CreateJUnitTestResultOptions {
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
    /** Worker/thread id the test ran on (Playwright parallelIndex, WDIO cid). */
    worker?: string;
    systemOut?: string;
    systemErr?: string;
}
/**
 * Options for updating a JUnit test suite
 */
interface UpdateJUnitTestSuiteOptions {
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
interface CreateJUnitPropertyOptions {
    name: string;
    value?: string;
    testSuiteId?: number;
    testResultId?: number;
    repositoryCaseId?: number;
}
/**
 * Options for creating a JUnit test step
 */
interface CreateJUnitTestStepOptions {
    testResultId: number;
    order: number;
    name?: string;
    status: JUnitResultType;
    duration?: number;
    message?: string;
    stackTrace?: string;
    screenshot?: string;
}

/**
 * Run-level metadata helpers.
 *
 * TestPlanIt test runs have no dedicated key/value metadata table, so run
 * metadata is stored as human-readable content in the run's `docs` field
 * (a TipTap/ProseMirror rich-text document rendered on the run detail page).
 *
 * Each metadata entry is one paragraph of the exact shape:
 *
 * ```json
 * {
 *   "type": "paragraph",
 *   "content": [
 *     { "type": "text", "marks": [{ "type": "bold" }], "text": "version: " },
 *     { "type": "text", "text": "1.2.3" }
 *   ]
 * }
 * ```
 *
 * i.e. a bold `key: ` prefix followed by the plain-text value. That shape is
 * both what a person would author by hand AND precise enough to round-trip:
 * merging only rewrites paragraphs whose first text node is bold and ends in
 * `: `, so surrounding hand-written documentation is preserved.
 *
 * Pure functions, no I/O — shared by {@link TestPlanItClient.setTestRunMetadata}
 * and exported for consumers that read/write run docs directly. For wrapping
 * PLAIN text in a TipTap doc use the existing {@link tipTapDoc} helper; this
 * module exists for the bold key/value shape and for merging without
 * clobbering surrounding content.
 */
/** A single metadata value. Numbers and booleans are stringified on write. */
type RunMetadataValue = string | number | boolean;
/** Key/value metadata attached to a test run. */
type RunMetadata = Record<string, RunMetadataValue>;
/**
 * Merge key/value metadata into a run's `docs` document.
 *
 * Existing metadata paragraphs with a matching key are updated in place;
 * new keys are appended at the end. All other document content is left
 * untouched. Keys that are empty after trimming are skipped. Returns a new
 * TipTap doc object (the input is not mutated) suitable for
 * `updateTestRun(id, { docs })`.
 */
declare function mergeRunMetadataIntoDoc(existingDocs: unknown, metadata: RunMetadata): Record<string, unknown>;
/**
 * Extract the key/value metadata pairs from a run's `docs` document.
 * Values always come back as strings (numbers/booleans are stringified on
 * write). Non-metadata content is ignored.
 */
declare function parseRunMetadataFromDoc(docs: unknown): Record<string, string>;

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
 * Detect a unique-constraint violation regardless of how the server phrases it.
 * Prefers stable signals — Postgres SQLSTATE 23505 surfaced as `dbErrorCode`
 * in the ZenStack error body, or a Prisma P2002 code — and falls back to the
 * known message phrasings for servers that only send text.
 */
declare function isUniqueConstraintViolation(error: unknown): boolean;
/**
 * CLI Lookup request
 */
interface LookupRequest {
    projectId?: number;
    type: "project" | "state" | "config" | "milestone" | "tag" | "folder" | "testRun";
    name: string;
    createIfMissing?: boolean;
}
/**
 * CLI Lookup response
 */
interface LookupResponse {
    id: number;
    name: string;
    created?: boolean;
}
/**
 * TestPlanIt API Client
 *
 * Official JavaScript/TypeScript client for interacting with the TestPlanIt API.
 * Uses the ZenStack /api/model endpoints for CRUD operations and /api/cli/lookup for name lookups.
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
    /**
     * Set after a create is rejected while carrying `worker` — an older server
     * (schema without JUnitTestResult.worker) fails the whole create over this
     * optional metadata, so stop sending it for the rest of the run.
     */
    private junitWorkerFieldUnsupported;
    constructor(config: TestPlanItClientConfig);
    /**
     * Make an authenticated request to the API
     */
    private request;
    /**
     * Make a ZenStack model API request
     * ZenStack endpoints are: /api/model/{model}/{operation}
     * Based on the OpenAPI spec:
     * - Read operations (findMany, findFirst, findUnique, count, aggregate, groupBy) use GET with ?q= parameter
     * - create, createMany, upsert use POST with body
     * - update, updateMany use PATCH with body
     * - delete, deleteMany use DELETE with body
     */
    private zenstack;
    /**
     * Make a multipart form data request
     */
    private requestFormData;
    private sleep;
    /**
     * Look up an entity by name and get its ID
     * Uses the /api/cli/lookup endpoint
     */
    lookup(options: LookupRequest): Promise<LookupResponse>;
    /**
     * Get project by ID
     */
    getProject(projectId: number): Promise<Project>;
    /**
     * List all projects accessible to the authenticated user
     */
    listProjects(): Promise<Project[]>;
    /**
     * Get all statuses for a project (with Automation scope)
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
     * Sets isCompleted to true and updates the workflow state to the first DONE state
     * @param testRunId - The test run ID
     * @param projectId - The project ID (required to look up the DONE workflow state)
     */
    completeTestRun(testRunId: number, projectId: number): Promise<TestRun>;
    /**
     * List test runs for a project
     * Uses the dedicated /api/test-runs/completed endpoint
     */
    listTestRuns(options: ListTestRunsOptions): Promise<PaginatedResponse<TestRun>>;
    /**
     * Find a test run by name using CLI lookup
     */
    findTestRunByName(projectId: number, name: string): Promise<TestRun | undefined>;
    /**
     * List all configurations
     */
    listConfigurations(_projectId?: number): Promise<Configuration[]>;
    /**
     * Find a configuration by name using CLI lookup
     */
    findConfigurationByName(projectId: number, name: string): Promise<Configuration | undefined>;
    /**
     * List all milestones for a project
     */
    listMilestones(projectId: number): Promise<Milestone[]>;
    /**
     * Find a milestone by name using CLI lookup
     */
    findMilestoneByName(projectId: number, name: string): Promise<Milestone | undefined>;
    /**
     * List all workflow states for a project (RUNS scope)
     */
    listWorkflowStates(projectId: number): Promise<WorkflowState[]>;
    /**
     * Find a workflow state by name using CLI lookup
     */
    findWorkflowStateByName(projectId: number, name: string): Promise<WorkflowState | undefined>;
    /**
     * List all folders for a project
     */
    listFolders(projectId: number): Promise<RepositoryFolder[]>;
    /**
     * Find a folder by name using CLI lookup
     */
    findFolderByName(projectId: number, name: string): Promise<RepositoryFolder | undefined>;
    /**
     * Create a new folder
     */
    createFolder(options: CreateFolderOptions): Promise<RepositoryFolder>;
    /**
     * In-flight and completed folder creations keyed by
     * projectId + parentId + name, so concurrent path walks that share an
     * ancestor (e.g. sibling describes) share a single create per folder.
     */
    private folderCreates;
    /**
     * Create a folder once per (projectId, parentId, name) for this client
     * instance — concurrent callers get the same promise. If another process
     * wins the race anyway, the unique-constraint violation is recovered by
     * re-fetching the existing folder.
     */
    private findOrCreateFolder;
    /**
     * Find or create a folder hierarchy from a path
     * @param projectId - The project ID
     * @param folderPath - Array of folder names representing the path (e.g., ['Suite A', 'Suite B', 'Suite C'])
     * @param rootFolderId - Optional root folder ID to start from
     * @returns The final folder in the path
     *
     * @example
     * // Create nested folders: "Custom Text" > "ADM-649" > "@smoke"
     * const folder = await client.findOrCreateFolderPath(projectId, ['Custom Text', 'ADM-649', '@smoke']);
     */
    findOrCreateFolderPath(projectId: number, folderPath: string[], rootFolderId?: number): Promise<RepositoryFolder>;
    /**
     * List all templates accessible to the user
     * ZenStack access control handles permission filtering automatically
     */
    listTemplates(_projectId?: number): Promise<Template[]>;
    /**
     * Find a template by name (case-insensitive)
     * Logs available templates if template not found for debugging
     */
    findTemplateByName(projectId: number, name: string): Promise<Template | undefined>;
    /**
     * List all tags
     */
    listTags(_projectId?: number): Promise<Tag[]>;
    /**
     * Create a new tag
     */
    createTag(options: CreateTagOptions): Promise<Tag>;
    /**
     * Find a tag by name using CLI lookup
     */
    findTagByName(projectId: number, name: string): Promise<Tag | undefined>;
    /**
     * Find or create a tag by name using CLI lookup with createIfMissing
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
     * Create many test cases in a single request.
     *
     * POSTs to the bulk-create endpoint, which resolves shared context once and
     * persists each case — with its steps, tags, and custom-field values — in a
     * transaction (one per distinct folder/state group). Far faster than calling
     * {@link createTestCase} per case, and returns a per-case result so partial
     * failures are visible: each entry is `status: "success"` with a `caseId`, or
     * `status: "error"` with a message (e.g. a custom field not on the template).
     *
     * `templateId` defaults to the project's first enabled template; resolve a
     * specific one with {@link findTemplateByName}. Resolve `folderId` with
     * {@link findFolderByName} / {@link findOrCreateFolderPath}.
     *
     * Requires a TestPlanIt instance (app v0.39.0+) exposing
     * `/api/projects/{projectId}/cases/bulk-create`.
     */
    createTestCases(options: CreateTestCasesOptions): Promise<CreateTestCasesResult>;
    /**
     * Get a test case by ID
     */
    getTestCase(caseId: number): Promise<RepositoryCase>;
    /**
     * Find test cases matching criteria
     */
    findTestCases(options: FindTestCaseOptions): Promise<RepositoryCase[]>;
    /**
     * Find an existing test case by a custom field value, matched by the field's
     * display name.
     *
     * Unlike {@link findTestCases} / {@link findOrCreateTestCase} (which key off
     * name + className + source), this resolves a case purely by a value stored
     * in its `caseFieldValues`. That lets an automated run attach to a
     * manually-authored case — regardless of the case's `source` — when the case
     * carries a legacy external identifier as a custom field (e.g. an ID
     * backfilled onto MANUAL cases after migrating from another test manager).
     *
     * The stored JSON `value` is matched in both its number and string forms:
     * Integer/Number fields persist as a JSON number (`89434`) while Text fields
     * persist as a JSON string (`"89434"`), so resolution never hinges on the
     * field's underlying type.
     *
     * Returns the first active (non-deleted) matching case, or `undefined` when
     * nothing matches — including when the named field does not exist on the
     * project (the relation filter simply matches no rows; it does not throw).
     */
    findTestCaseByCustomField(options: FindTestCaseByCustomFieldOptions): Promise<RepositoryCase | undefined>;
    /**
     * Update mutable scalar fields on an existing test case.
     *
     * A minimal, forward-compatible partial update: only the fields present in
     * `options` are written (currently just `automated`), so more fields can be
     * added later without a breaking change. Relation fields (folder, template,
     * state, …) are intentionally out of scope — use the dedicated helpers for
     * those.
     *
     * Used to flip a manually-authored case to `automated: true` once it starts
     * receiving automated results (see the WDIO reporter's `matchByCustomField`).
     */
    updateTestCase(caseId: number, options: UpdateTestCaseOptions): Promise<RepositoryCase>;
    /**
     * Find or create a test case
     * First searches for an active (non-deleted) test case in an active folder, then creates if not found.
     * If a matching case exists in a deleted folder, it will be moved to the specified folder.
     *
     * @returns Object containing the test case and an action indicating what happened:
     *   - 'found': An existing test case was found in an active folder
     *   - 'moved': A test case was found in a deleted folder and moved to the specified folder
     *   - 'created': A new test case was created
     */
    findOrCreateTestCase(options: CreateTestCaseOptions): Promise<FindOrCreateTestCaseResult>;
    /**
     * Create an authored step on a test case.
     * `step` and `expectedResult` are stored as TipTap rich-text documents to
     * match the in-app step editor.
     */
    createStep(options: CreateStepOptions): Promise<Step>;
    /**
     * Create many authored steps on a test case in a single request.
     * Preferred over repeated {@link createStep} calls when seeding a case's
     * steps — one `createMany` instead of N creates keeps the call count (and
     * rate-limit pressure) low when reporting large suites. Uses the scalar
     * `testCaseId` FK because `createMany` does not accept nested relations.
     */
    createSteps(options: CreateStepsOptions): Promise<{
        count: number;
    }>;
    /**
     * Soft-delete every active step on a test case (sets `isDeleted: true`).
     * Used to replace a case's steps when syncing them from automation.
     * Returns the number of steps that were soft-deleted.
     */
    softDeleteCaseSteps(testCaseId: number): Promise<number>;
    /**
     * Request opt-in, background LLM step derivation for low-structure cases
     * (e.g. Mocha/Jasmine, which have no native steps to map deterministically).
     * Enqueues a server-side job that runs ONLY when an LLM provider is configured
     * for the project; otherwise it is inert. With `overwrite`, cases that already
     * have steps are re-derived (destructive). Returns whether a job was enqueued.
     */
    requestStepDerivation(options: RequestStepDerivationOptions): Promise<{
        enqueued: boolean;
    }>;
    /**
     * Generate a QuickScript (AI-authored automation script) from one or more
     * stored test cases. The server resolves the project's export template and —
     * when a code repository is connected — pulls repo context so the script
     * follows the repo's existing framework/fixtures/page objects. On LLM failure
     * or when no LLM integration is configured, each file falls back to the
     * deterministic template render (`generatedBy: "template"`).
     */
    generateQuickScript(options: GenerateQuickScriptOptions): Promise<GenerateQuickScriptResult>;
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
     * Upload file to storage
     * Uses the /api/upload-attachment endpoint to upload to S3/MinIO
     */
    private uploadFile;
    /**
     * Upload an attachment to a test run result (for regular test runs)
     * Uploads the file to storage and creates an Attachment record
     */
    uploadAttachment(testRunResultId: number, file: Blob | Buffer, fileName: string, mimeType?: string): Promise<Attachment>;
    /**
     * Upload an attachment to a JUnit test result (for automated test runs)
     * Uploads the file to storage and creates an Attachment record linked to the JUnit result
     */
    uploadJUnitAttachment(junitTestResultId: number, file: Blob | Buffer, fileName: string, mimeType?: string, note?: string): Promise<Attachment>;
    /**
     * Attach an external link to a test run (run-level, not tied to a result).
     *
     * Creates an attachment record with `mimeType: "text/uri-list"` pointing at
     * the given URL — the run detail page renders it as a clickable link. Use
     * this for CI build URLs, dashboards, or any external resource for the run.
     *
     * The attachment's creator is resolved server-side from the API token, so
     * no user ID needs to be supplied.
     *
     * @param testRunId - The test run to attach the link to
     * @param url - The external URL
     * @param name - Display name for the link (defaults to the URL)
     * @param note - Optional note shown with the attachment
     */
    addTestRunLink(testRunId: number, url: string, name?: string, note?: string): Promise<Attachment>;
    /**
     * Upload a file attachment to a test run (run-level, not tied to a result).
     *
     * Uploads the file to storage and creates an attachment record connected to
     * the run itself, so it shows on the run detail page. For per-result
     * attachments use {@link uploadAttachment} / {@link uploadJUnitAttachment}.
     *
     * @param testRunId - The test run to attach the file to
     * @param file - File content as a Blob or Buffer
     * @param fileName - Name for the attachment
     * @param mimeType - MIME type (defaults to application/octet-stream)
     */
    uploadTestRunAttachment(testRunId: number, file: Blob | Buffer, fileName: string, mimeType?: string): Promise<Attachment>;
    /**
     * Set key/value metadata on a test run.
     *
     * Metadata is rendered into the run's `docs` rich-text field (shown on the
     * run detail page) as one `**key:** value` line per entry. Repeated calls
     * merge: existing keys are updated in place, new keys are appended, and any
     * hand-written documentation content is preserved. See
     * {@link mergeRunMetadataIntoDoc} for the exact document shape.
     *
     * Note: the merge is read-modify-write on the run's docs; concurrent calls
     * against the same run may race (last write wins).
     *
     * @param testRunId - The test run to set metadata on
     * @param metadata - Key/value pairs (numbers/booleans are stringified)
     * @returns The updated test run
     */
    setTestRunMetadata(testRunId: number, metadata: RunMetadata): Promise<TestRun>;
    /**
     * Read the key/value metadata previously written to a test run's `docs`
     * field (by {@link setTestRunMetadata} or hand-authored in the same
     * `**key:** value` shape). Values are always strings.
     */
    getTestRunMetadata(testRunId: number): Promise<Record<string, string>>;
    /**
     * Create a JUnit test suite
     * Used for storing test results from automated test frameworks (Mocha, JUnit, etc.)
     */
    createJUnitTestSuite(options: CreateJUnitTestSuiteOptions): Promise<JUnitTestSuite>;
    /**
     * Create a JUnit test result
     * Used for storing individual test case results within a test suite
     */
    createJUnitTestResult(options: CreateJUnitTestResultOptions): Promise<JUnitTestResult>;
    /**
     * Update a JUnit test suite
     * Used to update statistics (tests, failures, errors, skipped, time) after all results are reported
     */
    updateJUnitTestSuite(testSuiteId: number, options: UpdateJUnitTestSuiteOptions): Promise<JUnitTestSuite>;
    /**
     * Get JUnit test suites for a test run
     */
    getJUnitTestSuites(testRunId: number): Promise<JUnitTestSuite[]>;
    /**
     * Get JUnit test results for a test suite
     */
    getJUnitTestResults(testSuiteId: number): Promise<JUnitTestResult[]>;
    /**
     * Test the API connection by listing projects
     */
    testConnection(): Promise<boolean>;
    /**
     * Get the base URL
     */
    getBaseUrl(): string;
}

/**
 * Wrap plain text in a minimal TipTap (ProseMirror) document so it renders
 * in the in-app step editor. Empty (or whitespace-only) text produces a
 * paragraph with an EMPTY content array — an empty text node
 * (`{ type: "text", text: "" }`) is invalid in ProseMirror.
 *
 * Shared, pure helper (promoted from a private `TestPlanItClient` method) so
 * both the client's step-write methods and step-derivation callers that write
 * to the database directly produce identical TipTap docs. No imports, no side
 * effects — uses only `JSON.stringify`.
 */
declare function tipTapDoc(text: string): string;

/**
 * Convert a normalized `AutomationStep[]` into ordered, plain-text case
 * `Steps` rows. Pure, DB-free, format-agnostic, synchronous: the per-surface
 * adapter (the result importer or the Playwright / WDIO reporters) produces
 * the normalized input and decides what counts as a mappable step — this
 * mapper does NO trace-filtering and trusts its input (D-02, D-15). The caller
 * wraps each row's `step`/`expectedResult` into TipTap-JSON on write; this
 * function itself never touches the DB or an LLM.
 *
 * Deterministic split rules:
 *  - precondition (Gherkin `Given`) → a leading "Step 0" row, no expectedResult (D-08)
 *  - action (Gherkin `When`)        → a step row (D-07)
 *  - assertion (Gherkin `Then`)     → does NOT create a row; its title becomes the
 *      expectedResult of the LAST step of the immediately preceding When-group.
 *      A contiguous group of assertions CONCATENATES (joined with "\n") into that
 *      single expectedResult — never new rows (D-07). With no preceding When it
 *      attaches to the last emitted row, e.g. the last Given/Step-0 (D-08).
 *  - Playwright nesting (D-09): an action whose immediate `children` include
 *      assertion(s) takes their joined titles as its expectedResult.
 *
 * Steps that are not the last in a When-group keep an empty (omitted)
 * expectedResult — one is never invented (D-07, D-10); an empty expectedResult
 * is valid output. Returns `[]` for empty/low-structure input (D-14).
 *
 * Single non-recursive O(n) pass over the top-level array; `children` are
 * inspected only one level deep, bounding stack depth and time (DoS, T-01-01).
 */
declare function automationStepsToCaseSteps(steps: AutomationStep[]): CaseStepRow[];
/**
 * Never-overwrite guard wrapper (CORE-01). Encodes the decision "only derive
 * steps for a case that has none" given a caller-supplied signal — it does NOT
 * query the database itself. The live "does this case already have steps?"
 * fetch is the per-surface call site's job, deferred to later phases (Phase 2
 * importer: `prisma.steps.findFirst({ where: { testCaseId, isDeleted: false } })`;
 * Phase 3 reporter: its existing client) (D-11, D-12).
 *
 * When `existingStepCount >= 1` (the case already has at least one non-deleted
 * step), returns `[]` with no side effects — derivation never clobbers
 * existing, possibly human-edited steps. When `existingStepCount === 0`,
 * returns the full mapped rows.
 *
 * This wrapper does NOT remove or bypass the reporters' explicit, opt-in
 * `overwriteSteps` escape hatch — that destructive opt-in stays a documented
 * caller concern (D-13).
 */
declare function deriveCaseStepsIfFresh(steps: AutomationStep[], existingStepCount: number): CaseStepRow[];

export { type AddTestCaseToRunOptions, type ApiError, type Attachment, type AutomationStep, type BulkTestCaseInput, type BulkTestCaseResult, type BulkTestCaseStep, type CaseStepRow, type Comment, type Configuration, type CreateFolderOptions, type CreateJUnitPropertyOptions, type CreateJUnitTestResultOptions, type CreateJUnitTestStepOptions, type CreateJUnitTestSuiteOptions, type CreateStepOptions, type CreateStepsOptions, type CreateTagOptions, type CreateTestCaseOptions, type CreateTestCasesOptions, type CreateTestCasesResult, type CreateTestResultOptions, type CreateTestRunOptions, type FindOrCreateTestCaseResult, type FindTestCaseByCustomFieldOptions, type FindTestCaseOptions, type GenerateQuickScriptOptions, type GenerateQuickScriptResult, type ImportProgressEvent, type ImportTestResultsOptions, type Issue, type JUnitProperty, type JUnitResultType, type JUnitTestResult, type JUnitTestStep, type JUnitTestSuite, type ListTestRunsOptions, type Milestone, type NormalizedStatus, type PaginatedResponse, type Project, type QuickScriptFile, type QuickScriptOutputMode, type RepositoryCase, type RepositoryCaseSource, type RepositoryFolder, type RequestStepDerivationCase, type RequestStepDerivationOptions, type RunMetadata, type RunMetadataValue, type Status, type Step, type Tag, type Template, TestPlanItClient, type TestPlanItClientConfig, TestPlanItError, type TestRun, type TestRunCase, type TestRunResult, type TestRunStepResult, type TestRunType, type UpdateJUnitTestSuiteOptions, type UpdateTestCaseOptions, type UpdateTestRunOptions, type UploadAttachmentOptions, type User, type WorkflowState, automationStepsToCaseSteps, deriveCaseStepsIfFresh, isUniqueConstraintViolation, mergeRunMetadataIntoDoc, parseRunMetadataFromDoc, tipTapDoc };
